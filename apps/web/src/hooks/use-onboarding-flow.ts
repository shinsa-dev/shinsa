import type {
  OnboardingFlow,
  OnboardingProjectChoice,
  OnboardingReply,
  OnboardingStepId,
} from '@shinsa/core';
import { toast } from '@shinsa/ui/components/sonner';
import { Effect } from 'effect';
import * as React from 'react';
import { useAppEffect } from '@/hooks/use-app-effect.ts';
import { describeFailure } from '@/lib/connection/commands.ts';
import { replyToOnboarding, requestOnboardingFlow } from '@/lib/connection/onboarding.ts';
import {
  HELP_KEY,
  REFRESH_KEY,
  REVISE_KEY,
  resolveSetupEndPath,
  resolveStepDirection,
  type StepDirection,
  SUBMIT_KEY,
} from '@/lib/onboarding.ts';
import { runApp } from '@/lib/runtime/app.ts';
import { StepFailed } from '@/lib/runtime/schema.ts';
import { navigate, replaceRoute } from '@/router.ts';

export function useOnboardingFlow() {
  const [flow, setFlow] = React.useState<OnboardingFlow | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);
  const [direction, setDirection] = React.useState<StepDirection>('none');
  const [attempt, setAttempt] = React.useState(0);
  const index = React.useRef<number | null>(null);

  const enterOnboarding = (request: () => Promise<OnboardingFlow>) =>
    Effect.tryPromise({
      try: request,
      catch: (error) => new StepFailed({ message: describeFailure(error) }),
    });

  const show = React.useCallback((next: OnboardingFlow) => {
    setDirection(resolveStepDirection(index.current, next.index));
    index.current = next.index;
    setFlow(next);
  }, []);

  useAppEffect(
    () =>
      Effect.sync(() => setFailure(null)).pipe(
        Effect.andThen(enterOnboarding(requestOnboardingFlow)),
        Effect.matchEffect({
          onSuccess: (next) =>
            Effect.sync(() => {
              if (next.step === null) replaceRoute('/');
              else show(next);
            }),
          onFailure: (failed) => Effect.sync(() => setFailure(failed.message)),
        })
      ),
    [attempt, show]
  );

  function run(key: string, request: () => Promise<OnboardingFlow>) {
    return runApp(
      Effect.sync(() => setPending(key)).pipe(
        Effect.andThen(enterOnboarding(request)),
        Effect.matchEffect({
          onSuccess: (next) =>
            Effect.sync(() => {
              if (next.step === null) navigate(resolveSetupEndPath(next));
              else show(next);
              return true;
            }),
          onFailure: (failed) =>
            Effect.sync(() => {
              toast.error(failed.message);
              return false;
            }),
        }),
        Effect.ensuring(Effect.sync(() => setPending(null)))
      )
    );
  }

  function send(reply: OnboardingReply, key: string) {
    return run(key, () => replyToOnboarding(reply));
  }

  return {
    flow,
    failure,
    pending,
    direction,
    answer: (
      stepId: OnboardingStepId,
      values: string[],
      key = SUBMIT_KEY,
      projects?: OnboardingProjectChoice[]
    ) => send({ type: 'answer', stepId, values, ...(projects ? { projects } : {}) }, key),
    revise: (text: string, projects: OnboardingProjectChoice[]) =>
      send({ type: 'revise', stepId: 'projects', text, projects }, REVISE_KEY),
    open: (stepId: OnboardingStepId) => send({ type: 'open', stepId }, `open:${stepId}`),
    help: (stepId: OnboardingStepId) => send({ type: 'help', stepId }, HELP_KEY),
    refresh: () => run(REFRESH_KEY, requestOnboardingFlow),
    retry: () => setAttempt(attempt + 1),
  };
}
