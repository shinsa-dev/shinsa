import type { ShinsaState } from './project.ts';

export const STATE_RECORDS = [
  'repos',
  'projects',
  'taskNumbers',
  'tasks',
  'runs',
  'gates',
  'evidence',
  'briefings',
  'schedules',
  'sessionUsage',
] as const;

export type StateRecordKey = (typeof STATE_RECORDS)[number];

export const STATE_FIELDS = ['focus', 'settings', 'onBehalfActions'] as const;

export type StateFieldKey = (typeof STATE_FIELDS)[number];

type StateEntry<K extends StateRecordKey> = ShinsaState[K][string];

export type StateChanges = Partial<Record<StateRecordKey, string[]>>;

interface Draft {
  owned: Set<StateRecordKey>;
  changed: Map<StateRecordKey, Set<string>>;
}

const DRAFTS = new WeakMap<ShinsaState, Draft>();

export function createDraft(state: ShinsaState): ShinsaState {
  const draft = { ...state };
  DRAFTS.set(draft, { owned: new Set(), changed: new Map() });
  return draft;
}

export function sealDraft(state: ShinsaState): StateChanges {
  const draft = DRAFTS.get(state);
  DRAFTS.delete(state);
  const changes: StateChanges = {};
  for (const [key, ids] of draft?.changed ?? []) changes[key] = [...ids];
  return changes;
}

function ownRecord(state: ShinsaState, key: StateRecordKey, id: string): Record<string, unknown> {
  const draft = DRAFTS.get(state);
  if (!draft) return state[key];
  if (!draft.owned.has(key)) {
    Object.assign(state, { [key]: { ...state[key] } });
    draft.owned.add(key);
  }
  const ids = draft.changed.get(key) ?? new Set<string>();
  draft.changed.set(key, ids.add(id));
  return state[key];
}

export function writeEntry<K extends StateRecordKey>(
  state: ShinsaState,
  key: K,
  id: string,
  value: StateEntry<K>
) {
  ownRecord(state, key, id)[id] = value;
}

export function removeEntry(state: ShinsaState, key: StateRecordKey, id: string) {
  if (!Object.hasOwn(state[key], id)) return;
  delete ownRecord(state, key, id)[id];
}
