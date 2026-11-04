import { Onboarding, type OnboardingContext } from '../../apps/engine/src/onboarding/index.ts';

export function createIdleOnboarding(
  context: Pick<OnboardingContext, 'engine' | 'config' | 'store' | 'roots'>
) {
  return new Onboarding({
    ...context,
    resolveLogin: () => Promise.resolve(null),
    ask: () => Promise.resolve(null),
    run: (command) =>
      Promise.resolve({ ok: true, code: 0, stdout: `${command[0]} 1.0`, stderr: '', timedOut: false }),
    models: { listModels: () => Promise.resolve([]) },
    accounts: () => Promise.resolve([]),
  });
}
