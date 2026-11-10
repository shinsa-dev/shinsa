import { Option, Result, Schema } from 'effect';
import { ServerMessageText } from '../../../apps/web/src/lib/connection/engine-socket/schema.ts';
import {
  applyStatePatch,
  type ShinsaState,
  serializeState,
  type WireState,
} from '../../../packages/core/src/index.ts';
import { PUSH_PREVIEW_LENGTH, PushRefused } from './schema.ts';
import { summarize } from './stats.ts';

const decodeMessage = Schema.decodeUnknownOption(ServerMessageText);

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

function applyPush(
  state: Option.Option<WireState>,
  payload: string
): Result.Result<Option.Option<WireState>, PushRefused> {
  const message = decodeMessage(payload);
  if (Option.isNone(message)) {
    return Result.fail(
      new PushRefused({
        message: `The web client's ServerMessage schema refuses a push the hub sent, so the bench would time a dropped message: ${payload.slice(0, PUSH_PREVIEW_LENGTH)}`,
      })
    );
  }
  if (message.value.type === 'state') return Result.succeed(Option.some(message.value.state));
  if (message.value.type !== 'state.patch') return Result.succeed(state);
  const { patch } = message.value;
  return Result.succeed(Option.flatMap(state, (current) => applyStatePatch(current, patch)));
}

export function measurePushes(initial: string, payloads: readonly string[]) {
  return Result.gen(function* () {
    let state = yield* applyPush(Option.none(), initial);
    const sample: number[] = [];
    for (const payload of payloads) {
      const started = performance.now();
      state = yield* applyPush(state, payload);
      sample.push(performance.now() - started);
    }
    return summarize(sample);
  });
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
