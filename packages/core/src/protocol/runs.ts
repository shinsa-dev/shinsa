import { Option } from 'effect';
import type { Run } from '../domain/index.ts';
import { type FixFocus, resolveFixFocus } from '../prompts/index.ts';
import { ENGINE_STATE_FIELDS } from '../state/draft.ts';
import type { ShinsaState } from '../state/project.ts';
import type { WireRun, WireState } from './schema.ts';

const WIRE_RUNS = new WeakMap<object, WireRun>();

const WIRE_RECORDS = new WeakMap<object, Record<string, WireRun>>();

export function serializeRun(run: Run & { fixFocus?: FixFocus }): WireRun {
  if (!Object.hasOwn(run, 'prompt') && !Object.hasOwn(run, 'rolePrompt') && !Object.hasOwn(run, 'told'))
    return run;
  const known = WIRE_RUNS.get(run);
  if (known) return known;
  const { prompt: _prompt, rolePrompt: _rolePrompt, told: _told, ...rest } = run;
  const wire: WireRun = Option.match(resolveFixFocus(run), {
    onNone: () => rest,
    onSome: (focus) => ({ ...rest, fixFocus: focus }),
  });
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

const WIRE_STATES = new WeakMap<ShinsaState, WireState>();

function isWireShaped(state: ShinsaState, runs: Record<string, WireRun>) {
  return runs === state.runs && ENGINE_STATE_FIELDS.every((key) => !Object.hasOwn(state, key));
}

export function serializeState(state: ShinsaState): WireState {
  const runs = serializeRuns(state.runs);
  if (isWireShaped(state, runs)) return state;
  const known = WIRE_STATES.get(state);
  if (known) return known;
  const { autopilotModel: _model, autopilotHistory: _history, ...rest } = state;
  const wire: WireState = { ...rest, runs };
  WIRE_STATES.set(state, wire);
  return wire;
}
