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
import * as React from 'react';
import { describeFailure, requestWithToast } from '@/lib/connection/commands.ts';
import { requestJson } from '@/lib/connection/http.ts';
import {
  describeAlreadySignedIn,
  describeChecked,
  describeOptimizerChanged,
  describePluginToggled,
  describeServerRemoval,
  describeSignedIn,
  describeSignedOut,
  describeSignInFailed,
  describeSkillToggled,
} from '@/lib/extensions.ts';
import { createSignal } from '@/lib/signal.ts';

interface ExtensionsView {
  snapshot: ExtensionsSnapshot | null;
  failure: string | null;
}

export const SIGN_IN_CHANNEL = 'shinsa-mcp';

export const SIGN_IN_POLL_MS = 2_000;

export const SIGN_IN_LIMIT_MS = 120_000;

export const CHECK_INTERVAL_MS = 60_000;

const signal = createSignal();

let view: ExtensionsView = { snapshot: null, failure: null };

let viewText = '';

let pending: Promise<void> | null = null;

let checking: Promise<void> | null = null;

let checkedAt = Number.NEGATIVE_INFINITY;

let stopWatch: (() => void) | null = null;

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

export function selectExtensions() {
  return view;
}

export function resetExtensions() {
  stopSignInWatch();
  pending = null;
  checking = null;
  checkedAt = Number.NEGATIVE_INFINITY;
  viewText = '';
  view = { snapshot: null, failure: null };
  signal.publish();
}

export function refreshExtensions() {
  pending ??= requestJson<ExtensionsSnapshot>('/api/extensions')
    .then(publishExtensions, recordFailure)
    .then(() => {
      pending = null;
    });
  return pending;
}

export function useExtensions(active = true) {
  React.useEffect(() => {
    if (active) void refreshExtensions();
  }, [active]);
  return React.useSyncExternalStore(signal.subscribe, selectExtensions);
}

async function requestExtensions(path: string, body: unknown) {
  const answer = await requestJson<ExtensionsSnapshot>(path, body);
  publishExtensions(answer);
  return answer;
}

function updateExtensions(path: string, body: unknown, done?: string) {
  return requestWithToast(() => requestExtensions(path, body), done);
}

export function requestServerCheck(now = Date.now()) {
  if (checking !== null) return checking;
  if (now - checkedAt < CHECK_INTERVAL_MS) return refreshExtensions().then(refreshExtensions);
  checkedAt = now;
  checking = requestExtensions('/api/extensions/check', {})
    .then(() => undefined, recordFailure)
    .then(() => {
      checking = null;
    });
  return checking;
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
    '/api/extensions/check',
    server ? { serverId: server.id } : {},
    describeChecked(server)
  );
}

function addServer(input: McpServerInput, done: string) {
  return updateExtensions('/api/extensions/servers/add', { server: input }, done);
}

function updateServer(server: McpServerSummary, input: McpServerInput, done: string) {
  return updateExtensions('/api/extensions/servers/update', { serverId: server.id, server: input }, done);
}

function removeServer(server: McpServerSummary) {
  return updateExtensions(
    '/api/extensions/servers/remove',
    { serverId: server.id },
    describeServerRemoval(server).done
  );
}

export function chooseServer(
  server: McpServerSummary,
  patch: { enabled?: boolean; scope?: ExtensionScope },
  done: string
) {
  return updateExtensions('/api/extensions/servers/choose', { serverId: server.id, ...patch }, done);
}

function signOutServer(server: McpServerSummary) {
  return updateExtensions(
    '/api/extensions/servers/sign-out',
    { serverId: server.id },
    describeSignedOut(server.name)
  );
}

export function chooseSkill(skill: SkillSummary, enabled: boolean) {
  return updateExtensions(
    '/api/extensions/skills/choose',
    { skillId: skill.id, enabled },
    describeSkillToggled(skill.name, enabled)
  );
}

export function chooseOptimizer(optimizer: ContextOptimizer, patch: Partial<ContextOptimizer>) {
  return updateExtensions('/api/extensions/optimizer', patch, describeOptimizerChanged(optimizer, patch));
}

export function choosePlugin(plugin: PluginSummary, enabled: boolean) {
  return updateExtensions(
    '/api/extensions/plugins/choose',
    { pluginId: plugin.id, enabled },
    describePluginToggled(plugin.name, enabled)
  );
}

interface SignInAnswer {
  authorizationUrl: string | null;
  snapshot: ExtensionsSnapshot;
}

function isSignInSettled(snapshot: ExtensionsSnapshot | null, serverId: string) {
  const server = snapshot?.servers.find((entry) => entry.id === serverId);
  return server?.signedIn === true && server.status.state !== 'needs_sign_in';
}

interface SignInMessage {
  channel?: unknown;
  ok?: unknown;
}

function readSignInMessage(data: unknown, channel: boolean): SignInMessage | null {
  if (typeof data !== 'object' || data === null) return channel ? {} : null;
  const message = data as SignInMessage;
  if (!channel && message.channel !== SIGN_IN_CHANNEL) return null;
  return message;
}

export function stopSignInWatch() {
  stopWatch?.();
}

function watchSignIn(server: McpServerSummary) {
  stopSignInWatch();
  const deadline = Date.now() + SIGN_IN_LIMIT_MS;
  const channel = new BroadcastChannel(SIGN_IN_CHANNEL);
  const stop = () => {
    clearInterval(timer);
    channel.close();
    window.removeEventListener('focus', onReturn);
    window.removeEventListener('message', onWindowMessage);
    document.removeEventListener('visibilitychange', onReturn);
    if (stopWatch === stop) stopWatch = null;
  };
  const poll = async () => {
    await refreshExtensions();
    if (stopWatch !== stop || !isSignInSettled(view.snapshot, server.id)) return;
    stop();
    toast.success(describeSignedIn(server.name));
  };
  const onMessage = (message: SignInMessage | null) => {
    if (!message) return;
    if (message.ok !== false) {
      void poll();
      return;
    }
    stop();
    toast.error(describeSignInFailed(server.name));
  };
  const onReturn = () => {
    if (document.visibilityState === 'visible') void poll();
  };
  const onWindowMessage = (event: MessageEvent) => onMessage(readSignInMessage(event.data, false));
  const timer = setInterval(() => {
    if (Date.now() >= deadline) stop();
    else void poll();
  }, SIGN_IN_POLL_MS);
  channel.onmessage = (event: MessageEvent) => onMessage(readSignInMessage(event.data, true));
  window.addEventListener('focus', onReturn);
  window.addEventListener('message', onWindowMessage);
  document.addEventListener('visibilitychange', onReturn);
  stopWatch = stop;
}

export async function signInServer(server: McpServerSummary) {
  const tab = window.open('about:blank', '_blank');
  try {
    const answer = await requestJson<SignInAnswer>('/api/extensions/servers/sign-in', {
      serverId: server.id,
    });
    publishExtensions(answer.snapshot);
    if (!answer.authorizationUrl) {
      tab?.close();
      toast.success(describeAlreadySignedIn(server.name));
      return true;
    }
    if (tab) tab.location.href = answer.authorizationUrl;
    else window.open(answer.authorizationUrl, '_blank');
    watchSignIn(server);
    return true;
  } catch (error) {
    tab?.close();
    toast.error(describeFailure(error));
    return false;
  }
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
