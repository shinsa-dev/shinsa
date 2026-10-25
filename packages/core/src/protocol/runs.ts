import type { Run } from '../domain/index.ts';
import { type FixFocus, resolveFixFocus } from '../prompts/index.ts';
import type { ShinsaState } from '../state/project.ts';

export type WireRun = Omit<Run, 'prompt' | 'rolePrompt'> & { fixFocus?: FixFocus };

export type WireState = Omit<ShinsaState, 'runs'> & { runs: Record<string, WireRun> };

const WIRE_RUNS = new WeakMap<object, WireRun>();

const WIRE_RECORDS = new WeakMap<object, Record<string, WireRun>>();

export function serializeRun(run: Run & { fixFocus?: FixFocus }): WireRun {
  if (!Object.hasOwn(run, 'prompt') && !Object.hasOwn(run, 'rolePrompt')) return run;
  const known = WIRE_RUNS.get(run);
  if (known) return known;
  const { prompt: _prompt, rolePrompt: _rolePrompt, ...rest } = run;
  const focus = resolveFixFocus(run);
  const wire: WireRun = focus ? { ...rest, fixFocus: focus } : rest;
  WIRE_RUNS.set(run, wire);
  return wire;
}

function serializeRuns(runs: Record<string, Run>) {
  const known = WIRE_RECORDS.get(runs);
  if (known) return known;
  const wire: Record<string, WireRun> = {};
  let changed = false;
  for (const [id, run] of Object.entries(runs)) {
    wire[id] = serializeRun(run);
    changed ||= wire[id] !== run;
  }
  const result = changed ? wire : runs;
  WIRE_RECORDS.set(runs, result);
  return result;
}

export function serializeState(state: ShinsaState): WireState {
  const runs = serializeRuns(state.runs);
  return runs === state.runs ? state : { ...state, runs };
}
