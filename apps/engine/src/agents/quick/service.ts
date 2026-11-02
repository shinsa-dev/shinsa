import { Effect } from 'effect';
import { describeError } from '../../log/index.ts';
import { type AgentProvider, resolveCapabilities } from '../providers/index.ts';
import { parseJsonObject } from './json.ts';
import { listModes, resolveQuickModel, resolveTextSystem } from './modes.ts';
import {
  QUICK_MARKER,
  QUICK_OFF,
  QuickAttemptFailed,
  type QuickFailure,
  type QuickMode,
  type QuickRequest,
  type QuickResult,
} from './schema.ts';

export const requestQuick = Effect.fn('Quick.request')(function* <T>(
  request: QuickRequest<T>,
  providers: readonly AgentProvider[]
) {
  const failed = (provider: AgentProvider, mode: QuickMode) => (error: unknown) =>
    new QuickAttemptFailed({
      provider: provider.id,
      mode,
      reason: `${provider.label} failed ${request.task}: ${describeError(error)}`,
    });

  const resolveFastMode = Effect.fn('Quick.fastMode')(function* (provider: AgentProvider, mode: QuickMode) {
    if (request.fastMode !== true || !resolveCapabilities(provider).fastMode) return false;
    const readFastMode = request.readFastMode;
    if (!readFastMode) return true;
    const availability = yield* Effect.tryPromise({
      try: () => readFastMode(provider.id),
      catch: failed(provider, mode),
    });
    return availability === 'available';
  });

  const requestAnswer = Effect.fn('Quick.answer')(function* (provider: AgentProvider, mode: QuickMode) {
    const model = resolveQuickModel(request, provider);
    const fastMode = yield* resolveFastMode(provider, mode);
    const completeStructured = provider.completeStructured;
    const schema = request.schema;
    if (mode === 'structured' && schema && completeStructured) {
      return yield* Effect.tryPromise({
        try: () =>
          completeStructured({
            system: request.system,
            prompt: request.prompt,
            model,
            fastMode,
            schema,
            ...(request.timeoutMs ? { timeoutMs: request.timeoutMs } : {}),
          }),
        catch: failed(provider, mode),
      });
    }
    const text = yield* Effect.tryPromise({
      try: () =>
        provider.complete({
          system: resolveTextSystem(request.system, request.schema),
          prompt: request.prompt,
          model,
          fastMode,
        }),
      catch: failed(provider, mode),
    });
    return parseJsonObject<unknown>(text);
  });

  const requestAttempt = Effect.fn('Quick.attempt')(function* (provider: AgentProvider, mode: QuickMode) {
    const refuse = (reason: string) => new QuickAttemptFailed({ provider: provider.id, mode, reason });
    const raw = yield* requestAnswer(provider, mode);
    if (raw === null || raw === undefined)
      return yield* refuse(`${provider.label} returned no result for ${request.task}.`);
    const value = yield* Effect.try({ try: () => request.parse(raw), catch: failed(provider, mode) });
    if (value === null)
      return yield* refuse(`${provider.label} returned invalid output for ${request.task}.`);
    return value;
  });

  const failures: QuickFailure[] = [];
  const setting = yield* Effect.sync(() => Bun.env[QUICK_MARKER]);
  if (setting === QUICK_OFF) return { value: null, failures } satisfies QuickResult<T>;
  for (const provider of providers) {
    for (const mode of listModes(provider, request.schema)) {
      const attempt = yield* Effect.result(requestAttempt(provider, mode));
      if (attempt._tag === 'Success') return { value: attempt.success, failures } satisfies QuickResult<T>;
      const { provider: id, mode: failedMode, reason } = attempt.failure;
      failures.push({ provider: id, mode: failedMode, reason });
    }
  }
  if (failures.length > 0)
    yield* Effect.logWarning('[Quick] Every provider failed; using the fallback').pipe(
      Effect.annotateLogs({ task: request.task, failures })
    );
  return { value: null, failures } satisfies QuickResult<T>;
});
