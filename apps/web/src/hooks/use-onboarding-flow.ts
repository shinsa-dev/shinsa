import type {
  OnboardingFlow,
  OnboardingProjectChoice,
  OnboardingReply,
  OnboardingStepId,
} from '@shinsa/core';
import { toast } from '@shinsa/ui/components/sonner';
import * as React from 'react';
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
import { navigate, replaceRoute } from '@/router.ts';

export function useOnboardingFlow() {
  const [flow, setFlow] = React.useState<OnboardingFlow | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);
  const [direction, setDirection] = React.useState<StepDirection>('none');
  const [attempt, setAttempt] = React.useState(0);
  const index = React.useRef<number | null>(null);

  const show = React.useCallback((next: OnboardingFlow) => {
    setDirection(resolveStepDirection(index.current, next.index));
    index.current = next.index;
    setFlow(next);
  }, []);

  React.useEffect(() => {
    let live = true;
    setFailure(null);
    requestOnboardingFlow().then(
      (next) => {
        if (!live) return;
        if (next.step === null) replaceRoute('/');
        else show(next);
      },
      (error: unknown) => {
        if (live) setFailure(describeFailure(error));
      }
    );
    return () => {
      live = false;
    };
  }, [attempt, show]);

  async function run(key: string, request: () => Promise<OnboardingFlow>) {
    setPending(key);
    try {
      const next = await request();
      if (next.step === null) navigate(resolveSetupEndPath(next));
      else show(next);
      return true;
    } catch (error) {
      toast.error(describeFailure(error));
      return false;
    } finally {
      setPending(null);
    }
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
