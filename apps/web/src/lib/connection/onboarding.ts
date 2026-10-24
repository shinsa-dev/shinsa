import type { OnboardingChat, OnboardingReply, OnboardingStatus, RootSuggestions } from '@shinsa/core';
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

export function requestOnboardingChat() {
  return requestJson<OnboardingChat>('/api/onboarding/chat');
}

export async function replyToOnboarding(reply: OnboardingReply) {
  const chat = await requestJson<OnboardingChat>('/api/onboarding/chat', reply);
  await refreshOnboardingStatus();
  return chat;
}

export async function restartOnboarding() {
  if (await requestWithToast(() => replyToOnboarding({ type: 'restart' }))) navigate('/onboarding');
}
