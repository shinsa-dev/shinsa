import { Effect } from 'effect';
import { type HttpContext, startHttpServer } from '../../apps/engine/test/helpers/web.ts';
import { createIdleOnboarding } from './onboarding.ts';

export function startIdleServer(context: Omit<HttpContext, 'models' | 'onboarding'>) {
  return startHttpServer({
    ...context,
    models: { listModels: Effect.succeed([]) } as unknown as HttpContext['models'],
    onboarding: createIdleOnboarding({ engine: context.engine, config: context.config }),
  });
}
