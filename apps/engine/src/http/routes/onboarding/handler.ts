import { EngineApi } from '@shinsa/core/engine-api';
import { Effect } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { requestPromise } from '../../failures.ts';
import { HttpServices } from '../../services/service.ts';

export const OnboardingHandlers = HttpApiBuilder.group(
  EngineApi,
  'onboarding',
  Effect.fn('OnboardingHandlers')(function* (handlers) {
    const { onboarding } = yield* HttpServices;

    return handlers
      .handle('status', () => requestPromise(() => onboarding.resolveStatus()))
      .handle('roots', ({ query }) => requestPromise(() => onboarding.listSuggestions(query.refresh === '1')))
      .handle('setup', ({ payload }) => requestPromise(() => onboarding.applySetup(payload)))
      .handle('prerequisites', () => requestPromise(() => onboarding.resolvePrerequisites()))
      .handle('privacy', () => requestPromise(() => onboarding.openPrivacySettings()))
      .handle('install', ({ payload }) => requestPromise(() => onboarding.openInstall(payload)))
      .handle('flow', () => requestPromise(() => onboarding.setup.resolve()))
      .handle('reply', ({ payload }) => requestPromise(() => onboarding.setup.reply(payload)));
  })
);
