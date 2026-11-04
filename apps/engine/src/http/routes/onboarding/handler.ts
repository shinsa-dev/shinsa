import { EngineApi } from '@shinsa/core/engine-api';
import { Effect } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { Onboarding } from '../../../onboarding/service.ts';
import { resolveRequestFailure } from '../../failures.ts';

export const OnboardingHandlers = HttpApiBuilder.group(
  EngineApi,
  'onboarding',
  Effect.fn('OnboardingHandlers')(function* (handlers) {
    const onboarding = yield* Onboarding;

    const answer = Effect.mapError(resolveRequestFailure);

    return handlers
      .handle('status', () => answer(onboarding.resolveStatus))
      .handle('roots', ({ query }) => answer(onboarding.listSuggestions(query.refresh === '1')))
      .handle('setup', ({ payload }) => answer(onboarding.applySetup(payload)))
      .handle('prerequisites', () => answer(onboarding.resolvePrerequisites))
      .handle('privacy', () => answer(onboarding.openPrivacySettings))
      .handle('install', ({ payload }) => answer(onboarding.openInstall(payload)))
      .handle('flow', () => answer(onboarding.setup.resolve))
      .handle('reply', ({ payload }) => answer(onboarding.setup.reply(payload)));
  })
);
