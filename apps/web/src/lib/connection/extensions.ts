import type {
  ContextOptimizer,
  ExtensionScope,
  ExtensionsSnapshot,
  McpServerInput,
  McpServerSummary,
  PluginSummary,
  SkillSummary,
} from '@shinsa/core';
import { toast } from '@shinsa/ui/components/sonner';
import { Clock, Effect } from 'effect';
import * as React from 'react';
import { describeFailure, requestWithToast } from '@/lib/connection/commands.ts';
import {
  describeAlreadySignedIn,
  describeChecked,
  describeOptimizerChanged,
  describePluginToggled,
  describeServerRemoval,
  describeSignedOut,
  describeSkillToggled,
} from '@/lib/extensions.ts';
import { runApp } from '@/lib/runtime/app.ts';
import { decodeAnswer } from '@/lib/runtime/engine/answers.ts';
import { EngineClient } from '@/lib/runtime/engine/service.ts';
import { createSharedRun } from '@/lib/runtime/shared-run.ts';
import { createSignal } from '@/lib/signal.ts';
import { SignInAnswer } from './schema.ts';
import { stopSignInWatch, watchSignIn } from './sign-in-watch.ts';

export { SIGN_IN_CHANNEL, SIGN_IN_LIMIT_MS, SIGN_IN_POLL_MS, stopSignInWatch } from './sign-in-watch.ts';

interface ExtensionsView {
  snapshot: ExtensionsSnapshot | null;
  failure: string | null;
}

type ExtensionEndpoints = EngineClient['Service']['extensions'];

export const CHECK_INTERVAL_MS = 60_000;

const signal = createSignal();

let view: ExtensionsView = { snapshot: null, failure: null };

let viewText = '';

let checking: { done: Promise<void> | null } | null = null;

let checkedAt = Number.NEGATIVE_INFINITY;

const decodeSignIn = decodeAnswer(SignInAnswer);

function publishExtensions(snapshot: ExtensionsSnapshot) {
  const text = JSON.stringify(snapshot);
  if (text === viewText && view.failure === null) return;
  viewText = text;
  view = { snapshot, failure: null };
  signal.publish();
}

function recordFailure(error: unknown) {
  view = { ...view, failure: describeFailure(error) };
  signal.publish();
}

const read = createSharedRun(
  Effect.gen(function* () {
    const engine = yield* EngineClient;
    publishExtensions(yield* engine.extensions.snapshot());
  }).pipe(Effect.catch((error) => Effect.sync(() => recordFailure(error))))
);

const replaceExtensions = Effect.fn('Extensions.replace')(function* (
  call: (extensions: ExtensionEndpoints) => Effect.Effect<ExtensionsSnapshot, Error>
) {
  const engine = yield* EngineClient;
  const answer = yield* call(engine.extensions);
  publishExtensions(answer);
  return answer;
});

const serverCheck = Effect.fn('Extensions.serverCheck')(function* (
  at: number | undefined,
  run: { done: Promise<void> | null }
) {
  const now = at ?? (yield* Clock.currentTimeMillis);
  if (now - checkedAt < CHECK_INTERVAL_MS) {
    yield* Effect.promise(() => read.run());
    return yield* Effect.promise(() => read.run());
  }
  checkedAt = now;
  checking = run;
  yield* replaceExtensions((extensions) => extensions.check({ payload: {} })).pipe(
    Effect.catch((error) => Effect.sync(() => recordFailure(error))),
    Effect.ensuring(
      Effect.sync(() => {
        if (checking === run) checking = null;
      })
    )
  );
});

const signIn = Effect.fn('Extensions.signIn')(function* (server: McpServerSummary) {
  const tab = window.open('about:blank', '_blank');
  const engine = yield* EngineClient;
  return yield* engine.extensions.signIn({ payload: { serverId: server.id } }).pipe(
    Effect.flatMap(decodeSignIn),
    Effect.map((answer) => {
      publishExtensions(answer.snapshot);
      if (!answer.authorizationUrl) {
        tab?.close();
        toast.success(describeAlreadySignedIn(server.name));
        return true;
      }
      if (tab) tab.location.href = answer.authorizationUrl;
      else window.open(answer.authorizationUrl, '_blank');
      watchSignIn(server, { refresh: refreshExtensions, read: () => view.snapshot });
      return true;
    }),
    Effect.catch((error) =>
      Effect.sync(() => {
        tab?.close();
        toast.error(error.message);
        return false;
      })
    )
  );
});

function updateExtensions(
  call: (extensions: ExtensionEndpoints) => Effect.Effect<ExtensionsSnapshot, Error>,
  done?: string
) {
  return requestWithToast(() => runApp(replaceExtensions(call)), done);
}

export function selectExtensions() {
  return view;
}

export function resetExtensions() {
  stopSignInWatch();
  read.reset();
  checking = null;
  checkedAt = Number.NEGATIVE_INFINITY;
  viewText = '';
  view = { snapshot: null, failure: null };
  signal.publish();
}

export function refreshExtensions() {
  return read.run();
}

export function useExtensions(active = true) {
  React.useEffect(() => {
    if (active) void refreshExtensions();
  }, [active]);
  return React.useSyncExternalStore(signal.subscribe, selectExtensions);
}

export function requestServerCheck(now?: number) {
  if (checking?.done) return checking.done;
  const run: { done: Promise<void> | null } = { done: null };
  run.done = runApp(serverCheck(now, run));
  return run.done;
}

export function useServerCheck() {
  React.useEffect(() => {
    void requestServerCheck();
  }, []);
}

function refreshWhenVisible() {
  if (document.visibilityState === 'visible') void refreshExtensions();
}

export function useRefreshOnReturn() {
  React.useEffect(() => {
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, []);
}

export function checkServers(server: McpServerSummary | null = null) {
  return updateExtensions(
    (extensions) => extensions.check({ payload: server ? { serverId: server.id } : {} }),
    describeChecked(server)
  );
}

function addServer(input: McpServerInput, done: string) {
  return updateExtensions((extensions) => extensions.addServer({ payload: { server: input } }), done);
}

function updateServer(server: McpServerSummary, input: McpServerInput, done: string) {
  return updateExtensions(
    (extensions) => extensions.updateServer({ payload: { serverId: server.id, server: input } }),
    done
  );
}

function removeServer(server: McpServerSummary) {
  return updateExtensions(
    (extensions) => extensions.removeServer({ payload: { serverId: server.id } }),
    describeServerRemoval(server).done
  );
}

export function chooseServer(
  server: McpServerSummary,
  patch: { enabled?: boolean; scope?: ExtensionScope },
  done: string
) {
  return updateExtensions(
    (extensions) => extensions.chooseServer({ payload: { serverId: server.id, ...patch } }),
    done
  );
}

function signOutServer(server: McpServerSummary) {
  return updateExtensions(
    (extensions) => extensions.signOut({ payload: { serverId: server.id } }),
    describeSignedOut(server.name)
  );
}

export function chooseSkill(skill: SkillSummary, enabled: boolean) {
  return updateExtensions(
    (extensions) => extensions.chooseSkill({ payload: { skillId: skill.id, enabled } }),
    describeSkillToggled(skill.name, enabled)
  );
}

export function chooseOptimizer(optimizer: ContextOptimizer, patch: Partial<ContextOptimizer>) {
  return updateExtensions(
    (extensions) => extensions.optimizer({ payload: { ...patch } }),
    describeOptimizerChanged(optimizer, patch)
  );
}

export function choosePlugin(plugin: PluginSummary, enabled: boolean) {
  return updateExtensions(
    (extensions) => extensions.choosePlugin({ payload: { pluginId: plugin.id, enabled } }),
    describePluginToggled(plugin.name, enabled)
  );
}

export function signInServer(server: McpServerSummary) {
  return runApp(signIn(server));
}

export interface ExtensionActions {
  check: (server: McpServerSummary | null) => Promise<unknown>;
  add: (input: McpServerInput, done: string) => Promise<boolean>;
  update: (server: McpServerSummary, input: McpServerInput, done: string) => Promise<boolean>;
  remove: (server: McpServerSummary) => Promise<unknown>;
  choose: (
    server: McpServerSummary,
    patch: { enabled?: boolean; scope?: ExtensionScope },
    done: string
  ) => Promise<unknown>;
  signIn: (server: McpServerSummary) => Promise<unknown>;
  signOut: (server: McpServerSummary) => Promise<unknown>;
  chooseSkill: (skill: SkillSummary, enabled: boolean) => Promise<unknown>;
  choosePlugin: (plugin: PluginSummary, enabled: boolean) => Promise<unknown>;
  chooseOptimizer: (optimizer: ContextOptimizer, patch: Partial<ContextOptimizer>) => Promise<unknown>;
}

export const EXTENSION_ACTIONS: ExtensionActions = {
  check: checkServers,
  add: addServer,
  update: updateServer,
  remove: removeServer,
  choose: chooseServer,
  signIn: signInServer,
  signOut: signOutServer,
  chooseSkill,
  choosePlugin,
  chooseOptimizer,
};
