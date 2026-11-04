import type { ExtensionsSnapshot, McpServerSummary } from '@shinsa/core';
import { toast } from '@shinsa/ui/components/sonner';
import { Clock, Effect } from 'effect';
import { describeSignedIn, describeSignInFailed } from '@/lib/extensions.ts';
import { forkApp } from '@/lib/runtime/app.ts';

export const SIGN_IN_CHANNEL = 'shinsa-mcp';

export const SIGN_IN_POLL_MS = 2_000;

export const SIGN_IN_LIMIT_MS = 120_000;

export interface SignInSource {
  refresh: () => Promise<void>;
  read: () => ExtensionsSnapshot | null;
}

interface SignInMessage {
  channel?: unknown;
  ok?: unknown;
}

let stopWatch: (() => void) | null = null;

function isSignInSettled(snapshot: ExtensionsSnapshot | null, serverId: string) {
  const server = snapshot?.servers.find((entry) => entry.id === serverId);
  return server?.signedIn === true && server.status.state !== 'needs_sign_in';
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

export function watchSignIn(server: McpServerSummary, source: SignInSource) {
  stopSignInWatch();
  forkApp(
    Effect.gen(function* () {
      const deadline = (yield* Clock.currentTimeMillis) + SIGN_IN_LIMIT_MS;
      const channel = new BroadcastChannel(SIGN_IN_CHANNEL);
      const stop = () => {
        clearInterval(timer);
        channel.close();
        window.removeEventListener('focus', onReturn);
        window.removeEventListener('message', onWindowMessage);
        document.removeEventListener('visibilitychange', onReturn);
        if (stopWatch === stop) stopWatch = null;
      };
      const poll = () =>
        forkApp(
          Effect.promise(source.refresh).pipe(
            Effect.andThen(
              Effect.sync(() => {
                if (stopWatch !== stop || !isSignInSettled(source.read(), server.id)) return;
                stop();
                toast.success(describeSignedIn(server.name));
              })
            )
          )
        );
      const onMessage = (message: SignInMessage | null) => {
        if (!message) return;
        if (message.ok !== false) {
          poll();
          return;
        }
        stop();
        toast.error(describeSignInFailed(server.name));
      };
      const onReturn = () => {
        if (document.visibilityState === 'visible') poll();
      };
      const onWindowMessage = (event: MessageEvent) => onMessage(readSignInMessage(event.data, false));
      const tick = Effect.gen(function* () {
        if ((yield* Clock.currentTimeMillis) >= deadline) stop();
        else poll();
      });
      const timer = setInterval(() => forkApp(tick), SIGN_IN_POLL_MS);
      channel.onmessage = (event: MessageEvent) => onMessage(readSignInMessage(event.data, true));
      window.addEventListener('focus', onReturn);
      window.addEventListener('message', onWindowMessage);
      document.addEventListener('visibilitychange', onReturn);
      stopWatch = stop;
    })
  );
}
