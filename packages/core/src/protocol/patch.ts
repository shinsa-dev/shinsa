import {
  STATE_FIELDS,
  STATE_RECORDS,
  type StateChanges,
  type StateFieldKey,
  type StateRecordKey,
} from '../state/draft.ts';
import type { ShinsaState } from '../state/project.ts';
import { serializeRun, type WireState } from './runs.ts';

export type ValueChange = { put: unknown } | { drop: number; append: unknown[] };

export type EntryChange =
  | { put: unknown }
  | { remove: true }
  | { fields: Record<string, ValueChange>; unset: string[] };

export interface StatePatch {
  from: number;
  to: number;
  fields: Partial<Record<StateFieldKey, ValueChange>>;
  records: Partial<Record<StateRecordKey, Record<string, EntryChange>>>;
}

type Fields = Record<string, unknown>;

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveAppend(previous: unknown[], next: unknown[]): ValueChange | null {
  if (next.length === 0) return null;
  const first = previous.indexOf(next[0]);
  if (first < 0) return null;
  const kept = previous.length - first;
  if (kept > next.length) return null;
  for (let index = 0; index < kept; index += 1) {
    if (previous[first + index] !== next[index]) return null;
  }
  return { drop: first, append: next.slice(kept) };
}

function resolveValueChange(previous: unknown, next: unknown): ValueChange {
  if (Array.isArray(previous) && Array.isArray(next)) {
    const appended = resolveAppend(previous, next);
    if (appended) return appended;
  }
  return { put: next };
}

function resolveEntryChange(previous: unknown, next: unknown): EntryChange | null {
  if (previous === next) return null;
  if (next === undefined) return { remove: true };
  if (!isFields(previous) || !isFields(next)) return { put: next };
  const fields: Record<string, ValueChange> = {};
  const unset: string[] = [];
  for (const [key, value] of Object.entries(next)) {
    if (previous[key] === value) continue;
    if (value === undefined) unset.push(key);
    else fields[key] = resolveValueChange(previous[key], value);
  }
  for (const key of Object.keys(previous)) {
    if (!Object.hasOwn(next, key)) unset.push(key);
  }
  if (unset.length === 0 && Object.keys(fields).length === 0) return null;
  return { fields, unset };
}

function readEntry(state: ShinsaState, key: StateRecordKey, id: string): unknown {
  if (key === 'runs') {
    const run = Object.hasOwn(state.runs, id) ? state.runs[id] : undefined;
    return run ? serializeRun(run) : undefined;
  }
  const record: Record<string, unknown> = state[key];
  return Object.hasOwn(record, id) ? record[id] : undefined;
}

export function resolveStatePatch(
  previous: ShinsaState,
  next: ShinsaState,
  changes: StateChanges
): StatePatch {
  const fields: StatePatch['fields'] = {};
  for (const key of STATE_FIELDS) {
    if (previous[key] !== next[key]) fields[key] = resolveValueChange(previous[key], next[key]);
  }
  const records: StatePatch['records'] = {};
  for (const key of STATE_RECORDS) {
    const entries: Record<string, EntryChange> = {};
    for (const id of changes[key] ?? []) {
      const change = resolveEntryChange(readEntry(previous, key, id), readEntry(next, key, id));
      if (change) entries[id] = change;
    }
    if (Object.keys(entries).length > 0) records[key] = entries;
  }
  return { from: previous.seq, to: next.seq, fields, records };
}

function applyValueChange(previous: unknown, change: ValueChange): unknown {
  if ('put' in change) return change.put;
  const kept = Array.isArray(previous) ? previous.slice(change.drop) : [];
  return [...kept, ...change.append];
}

function applyEntryChange(previous: unknown, change: EntryChange): unknown {
  if ('put' in change) return change.put;
  if ('remove' in change) return undefined;
  const entry: Fields = { ...(isFields(previous) ? previous : {}) };
  for (const [key, value] of Object.entries(change.fields)) {
    entry[key] = applyValueChange(entry[key], value);
  }
  for (const key of change.unset) delete entry[key];
  return entry;
}

export function applyStatePatch(state: WireState, patch: StatePatch): WireState | null {
  if (patch.from !== state.seq) return null;
  const next: Record<string, unknown> = { ...state, seq: patch.to };
  for (const [key, change] of Object.entries(patch.fields)) {
    next[key] = applyValueChange(next[key], change);
  }
  for (const [key, entries] of Object.entries(patch.records)) {
    const record: Record<string, unknown> = { ...(next[key] as Record<string, unknown>) };
    for (const [id, change] of Object.entries(entries)) {
      const entry = applyEntryChange(Object.hasOwn(record, id) ? record[id] : undefined, change);
      if (entry === undefined) delete record[id];
      else record[id] = entry;
    }
    next[key] = record;
  }
  return next as unknown as WireState;
}
