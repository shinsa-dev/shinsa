import {
  applyStatePatch,
  type ShinsaState,
  type StatePatch,
  serializeState,
  type WireState,
} from '../../../packages/core/src/index.ts';
import { summarize } from './stats.ts';

export function measurePushes(initial: string, payloads: readonly string[]) {
  let state: WireState | null = (JSON.parse(initial) as { state: WireState }).state;
  const sample: number[] = [];
  for (const payload of payloads) {
    const started = performance.now();
    const message = JSON.parse(payload) as { type: string; state?: WireState; patch?: StatePatch };
    if (message.type === 'state' && message.state) state = message.state;
    if (message.type === 'state.patch' && state && message.patch)
      state = applyStatePatch(state, message.patch);
    sample.push(performance.now() - started);
  }
  return summarize(sample);
}

export function measureClientApply(state: ShinsaState) {
  const measureParse = (payload: string) => {
    const sample: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const started = performance.now();
      JSON.parse(payload);
      sample.push(performance.now() - started);
    }
    return summarize(sample);
  };
  const full = JSON.stringify({ type: 'state', state });
  const wire = JSON.stringify({ type: 'state', state: serializeState(state) });
  return {
    fullStateBytes: full.length,
    fullStateParseMs: measureParse(full),
    wireStateBytes: wire.length,
    wireStateParseMs: measureParse(wire),
  };
}
