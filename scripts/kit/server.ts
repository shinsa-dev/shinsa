import { Effect } from 'effect';
import { type HttpContext, startHttpServer } from '../../apps/engine/test/helpers/web.ts';
import { createIdleOnboarding } from './onboarding.ts';

export const startIdleServer = Effect.fn('Kit.startIdleServer')(function* (
  context: Omit<HttpContext, 'models' | 'onboarding'>
) {
  const onboarding = yield* createIdleOnboarding({ engine: context.engine, config: context.config });
  return startHttpServer({
    ...context,
    models: { listModels: Effect.succeed([]) } as unknown as HttpContext['models'],
    onboarding,
  });
});
