import { Option, Schema } from 'effect';
import { ServerMessageText } from '../../../apps/web/src/lib/connection/engine-socket/schema.ts';
import {
  applyStatePatch,
  type ShinsaState,
  serializeState,
  type WireState,
} from '../../../packages/core/src/index.ts';
import { summarize } from './stats.ts';

const decodeMessage = Schema.decodeUnknownOption(ServerMessageText);

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

function applyPush(state: Option.Option<WireState>, payload: string) {
  const message = decodeMessage(payload);
  if (Option.isNone(message)) return state;
  if (message.value.type === 'state') return Option.some(message.value.state);
  if (message.value.type !== 'state.patch') return state;
  const { patch } = message.value;
  return Option.flatMap(state, (current) => applyStatePatch(current, patch));
}

export function measurePushes(initial: string, payloads: readonly string[]) {
  let state = applyPush(Option.none(), initial);
  const sample: number[] = [];
  for (const payload of payloads) {
    const started = performance.now();
    state = applyPush(state, payload);
    sample.push(performance.now() - started);
  }
  return summarize(sample);
}

export function measureClientApply(state: ShinsaState) {
  const measureParse = (payload: string) => {
    const sample: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const started = performance.now();
      decodeJson(payload);
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
