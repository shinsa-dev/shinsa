import type { OnboardingChat, OnboardingReply } from '@shinsa/core';
import { toast } from '@shinsa/ui/components/sonner';
import * as React from 'react';
import { describeFailure } from '@/lib/connection/commands.ts';
import { replyToOnboarding, requestOnboardingChat } from '@/lib/connection/onboarding.ts';
import { replaceRoute } from '@/router.ts';

export function useOnboardingChat() {
  const [chat, setChat] = React.useState<OnboardingChat | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let live = true;
    setFailure(null);
    requestOnboardingChat().then(
      (next) => {
        if (!live) return;
        if (next.prompt === null) replaceRoute('/');
        else setChat(next);
      },
      (error: unknown) => {
        if (live) setFailure(describeFailure(error));
      }
    );
    return () => {
      live = false;
    };
  }, [attempt]);

  async function pick(reply: OnboardingReply, label: string) {
    setPending(label);
    try {
      setChat(await replyToOnboarding(reply));
      return true;
    } catch (error) {
      toast.error(describeFailure(error));
      return false;
    } finally {
      setPending(null);
    }
  }

  return { chat, failure, pending, pick, retry: () => setAttempt(attempt + 1) };
}
