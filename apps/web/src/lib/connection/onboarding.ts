import type { OnboardingReply, OnboardingStatus, WorktreeUsage } from '@shinsa/core';
import { OpenAnswer } from '@shinsa/core/engine-api/schema';
import { Effect } from 'effect';
import * as React from 'react';
import { requestWithToast } from '@/lib/connection/commands.ts';
import { runApp } from '@/lib/runtime/app.ts';
import { decodeAnswer } from '@/lib/runtime/engine/answers.ts';
import { EngineClient } from '@/lib/runtime/engine/service.ts';
import { createSignal } from '@/lib/signal.ts';
import { InstallAnswer, PRIVACY_NOT_OPENED_MESSAGE, PrivacyNotOpened } from './schema.ts';

const signal = createSignal();

let status: OnboardingStatus | null = null;

let asking = false;

let known = false;

function publishStatus(next: OnboardingStatus) {
  status = next;
  known = true;
  signal.publish();
}

const decodeInstall = decodeAnswer(InstallAnswer);

const decodeOpened = decodeAnswer(OpenAnswer);

const readStatus = Effect.gen(function* () {
  const engine = yield* EngineClient;
  publishStatus(yield* engine.onboarding.status());
}).pipe(
  Effect.catch(() =>
    Effect.sync(() => {
      known = false;
    })
  ),
  Effect.ensuring(
    Effect.sync(() => {
      asking = false;
    })
  )
);

const writeRoots = Effect.fn('Onboarding.writeRoots')(function* (roots: string[]) {
  const engine = yield* EngineClient;
  publishStatus(yield* engine.onboarding.setup({ payload: { roots } }));
});

const writeWorktreesDir = Effect.fn('Onboarding.writeWorktreesDir')(function* (path: string | null) {
  const engine = yield* EngineClient;
  const next = yield* engine.onboarding.worktrees({ payload: { path } });
  publishStatus(next);
  return next;
});

type WorktreeUsageView = WorktreeUsage | 'failed' | null;

const measureWorktrees = Effect.fn('Onboarding.measureWorktrees')(function* (
  publish: (usage: WorktreeUsageView) => void
) {
  const engine = yield* EngineClient;
  const usage: WorktreeUsageView = yield* engine.onboarding
    .worktreeUsage()
    .pipe(Effect.catch(() => Effect.succeed('failed' as const)));
  publish(usage);
});

const readRootSuggestions = Effect.gen(function* () {
  const engine = yield* EngineClient;
  return yield* engine.onboarding.roots({ query: { refresh: '1' } });
});

const openPrivacy = Effect.gen(function* () {
  const engine = yield* EngineClient;
  const opened = yield* decodeOpened(yield* engine.onboarding.privacy({ payload: {} }));
  if (!opened.ok) return yield* new PrivacyNotOpened({ message: PRIVACY_NOT_OPENED_MESSAGE });
});

const readFlow = Effect.gen(function* () {
  const engine = yield* EngineClient;
  return yield* engine.onboarding.flow();
});

const reply = Effect.fn('Onboarding.reply')(function* (answer: OnboardingReply) {
  const engine = yield* EngineClient;
  const flow = yield* engine.onboarding.reply({ payload: { ...answer } });
  asking = true;
  yield* readStatus;
  return flow;
});

const install = Effect.fn('Onboarding.install')(function* (
  fix: { id: string } | { all: true } | { command: string }
) {
  const engine = yield* EngineClient;
  const answer = yield* engine.onboarding.install({ payload: { ...fix } });
  const installed = yield* decodeInstall(answer);
  return installed.terminal;
});

export function refreshOnboardingStatus() {
  asking = true;
  return runApp(readStatus);
}

export function resetOnboardingStatus() {
  status = null;
  asking = false;
  known = false;
  signal.publish();
}

export function useOnboardingStatus() {
  React.useEffect(() => {
    if (!asking && !known) void refreshOnboardingStatus();
  }, []);
  return React.useSyncExternalStore(signal.subscribe, () => status);
}

export function updateRoots(roots: string[], done: string) {
  return requestWithToast(() => runApp(writeRoots(roots)), done);
}

export function updateWorktreesDir(path: string | null) {
  return runApp(writeWorktreesDir(path));
}

export function useWorktreeUsage(folder: string) {
  const [usage, setUsage] = React.useState<WorktreeUsageView>(null);
  React.useEffect(() => {
    let current = true;
    setUsage(null);
    void runApp(
      measureWorktrees((next) => {
        if (current) setUsage(next);
      })
    );
    return () => {
      current = false;
    };
  }, [folder]);
  return usage;
}

export function requestRootSuggestions() {
  return runApp(readRootSuggestions);
}

export function requestPrivacySettings() {
  return requestWithToast(() => runApp(openPrivacy));
}

export function requestOnboardingFlow() {
  return runApp(readFlow);
}

export function replyToOnboarding(answer: OnboardingReply) {
  return runApp(reply(answer));
}

export function requestOnboardingInstall(fix: { id: string } | { all: true } | { command: string }) {
  return runApp(install(fix));
}
