import type { OnboardingFlow, OnboardingReply, OnboardingStatus, RootSuggestions } from '@shinsa/core';
import * as React from 'react';
import { requestWithToast } from '@/lib/connection/commands.ts';
import { requestJson } from '@/lib/connection/http.ts';
import { createSignal } from '@/lib/signal.ts';
import { navigate } from '@/router.ts';

const signal = createSignal();

let status: OnboardingStatus | null = null;

let statusRequest: Promise<void> | null = null;

function publishStatus(next: OnboardingStatus) {
  status = next;
  signal.publish();
}

export function refreshOnboardingStatus() {
  statusRequest = requestJson<OnboardingStatus>('/api/onboarding').then(publishStatus, () => {
    statusRequest = null;
  });
  return statusRequest;
}

export function resetOnboardingStatus() {
  status = null;
  statusRequest = null;
  signal.publish();
}

export function useOnboardingStatus() {
  React.useEffect(() => {
    if (!statusRequest) void refreshOnboardingStatus();
  }, []);
  return React.useSyncExternalStore(signal.subscribe, () => status);
}

export function updateRoots(roots: string[], done: string) {
  return requestWithToast(
    async () => publishStatus(await requestJson<OnboardingStatus>('/api/onboarding/setup', { roots })),
    done
  );
}

export function requestRootSuggestions() {
  return requestJson<RootSuggestions>('/api/onboarding/roots?refresh=1');
}

export function requestPrivacySettings() {
  return requestWithToast(async () => {
    const opened = await requestJson<{ ok: boolean }>('/api/onboarding/privacy', {});
    if (!opened.ok) {
      throw new Error(
        'System Settings did not open. Open it yourself and go to Privacy & Security → Full Disk Access.'
      );
    }
  });
}

export function requestOnboardingFlow() {
  return requestJson<OnboardingFlow>('/api/onboarding/flow');
}

export async function replyToOnboarding(reply: OnboardingReply) {
  const flow = await requestJson<OnboardingFlow>('/api/onboarding/flow', reply);
  await refreshOnboardingStatus();
  return flow;
}

export async function restartOnboarding() {
  if (await requestWithToast(() => replyToOnboarding({ type: 'restart' }))) navigate('/onboarding');
}
