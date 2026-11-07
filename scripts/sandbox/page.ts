import { join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { SECURITY_HEADERS } from '../../apps/cloud/src/http/ingress/schema.ts';
import { serveStatic } from '../../apps/engine/src/http/static.ts';
import {
  REMOTE_NATIVE_CLIENT,
  REMOTE_PATHS,
  resolveTeamJoinUrl,
  serializeShareUrl,
} from '../../packages/core/src/index.ts';
import {
  HOST,
  type Machine,
  ORIGIN,
  PORT,
  type PreviewShare,
  REMOTE_WEB,
  SANDBOX_PATH,
  SandboxFailed,
  type SandboxSection,
  type ServicePreview,
  TEAM_INVITE,
} from './schema.ts';
import { createShareLink } from './shares.ts';
import { TEAM, TEAM_KEY } from './team.ts';

export const findRemoteStylesheet = Effect.fn('Sandbox.findRemoteStylesheet')(function* () {
  const fs = yield* FileSystem.FileSystem;
  const html = yield* fs
    .readFileString(join(REMOTE_WEB, 'index.html'))
    .pipe(Effect.mapError(() => new SandboxFailed({ message: 'The remote build has no index.html.' })));
  const href = /<link rel="stylesheet"[^>]*href="([^"]+\.css)"/.exec(html)?.[1];
  if (!href) return yield* new SandboxFailed({ message: 'The remote build has no stylesheet.' });
  return href;
});

export const respondStatic = Effect.fn('Sandbox.respondStatic')(function* (pathname: string) {
  const response = yield* serveStatic(REMOTE_WEB, `/${pathname.replace(/^\/+/, '')}`);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
  return response;
});

export function listSandboxSections(
  machines: Machine[],
  teammate: Machine,
  shares: PreviewShare[],
  teamTask: string | null,
  preview: ServicePreview,
  duplicate: { duplicate: string; original: string | null }
): SandboxSection[] {
  const studioPort = machines[0]?.port;
  return [
    {
      title: 'Each machine’s own app',
      links: machines.flatMap((machine) => [
        { label: `${machine.name}: Home`, url: `http://${HOST}:${machine.port}/` },
        { label: `${machine.name}: Settings`, url: `http://${HOST}:${machine.port}/settings` },
      ]),
    },
    {
      title: 'The remote dashboard, always signed in',
      links: [
        { label: 'The merged dashboard', url: `${ORIGIN}${REMOTE_PATHS.app}` },
        { label: 'All tasks, each with its machine', url: `${ORIGIN}/tasks` },
        { label: 'Settings, with Machines', url: `${ORIGIN}/settings` },
      ],
    },
    {
      title: 'Adding a device and pairing',
      links: [
        ...machines.flatMap((machine) => [
          {
            label: `Add this device to ${machine.name}`,
            url: `${ORIGIN}${SANDBOX_PATH}/enroll/${machine.id}`,
          },
          {
            label: `Add this device to ${machine.name} as the machine it sits on`,
            url: `${ORIGIN}${SANDBOX_PATH}/enroll/${machine.id}?on=machine`,
          },
        ]),
        { label: 'Approve a pairing (code K7PQ)', url: `${ORIGIN}${REMOTE_PATHS.pairPage}?code=K7PQ` },
        {
          label: 'Sign in as the iPhone app does (answers shinsa://signed-in?code=preview)',
          url: `${ORIGIN}${REMOTE_PATHS.signIn}?client=${REMOTE_NATIVE_CLIENT}&redirect=shinsa://signed-in`,
        },
      ],
    },
    {
      title: 'Shared tasks, live links with no sign-in',
      links: [
        ...shares.flatMap((share) => [
          { label: share.label, url: share.url },
          {
            label: `The same task, ${share.handle}, on Studio`,
            url: `http://${HOST}:${share.port}/tasks/${share.handle}`,
          },
        ]),
        {
          label: 'A share link that no longer works',
          url: serializeShareUrl(ORIGIN, createShareLink('studio')),
        },
      ],
    },
    {
      title: 'The shared web service',
      links: [
        {
          label: `${preview.handle} on Studio, with its Services, Share preview and Stop sharing`,
          url: `http://${HOST}:${preview.port}/tasks/${preview.handle}`,
        },
        {
          label: `The shared preview of ${preview.handle}’s web service, with live updates`,
          url: preview.url,
        },
        {
          label: 'Stop the web service (the preview then says it is not running)',
          url: `${ORIGIN}${SANDBOX_PATH}/service/stop`,
        },
        { label: 'Start the web service again', url: `${ORIGIN}${SANDBOX_PATH}/service/start` },
        ...(preview.privateUrl
          ? [
              {
                label: `${preview.handle} through remote access: Open on its web service goes to the private address`,
                url: `${ORIGIN}/tasks/${preview.handle}`,
              },
              {
                label: `${preview.handle}’s web service at its private address, as Open goes there`,
                url: `${ORIGIN}${REMOTE_PATHS.previewOpen}?${new URLSearchParams({ url: preview.privateUrl })}`,
              },
              {
                label: 'The private address without signing in through Open (not shared)',
                url: preview.privateUrl,
              },
            ]
          : []),
        {
          label: 'A preview link that no longer works',
          url: `http://${'a'.repeat(32)}.localhost:${PORT}/`,
        },
      ],
    },
    {
      title: 'Teams',
      links: [
        {
          label: `Studio: the focus menu’s Teams section, then ${TEAM.name}, shows Kai’s tasks beside yours`,
          url: `http://${HOST}:${studioPort}/tasks`,
        },
        {
          label: `Studio: Settings, Teams, with Inês asking to join, What teammates can do, and Kai’s own scopes`,
          url: `http://${HOST}:${studioPort}/settings`,
        },
        {
          label: `The remote dashboard: Settings, Teams, with each person’s presence and last seen`,
          url: `${ORIGIN}/settings`,
        },
        {
          label: `The remote dashboard: All tasks, with Kai’s MacBook in your fleet and its tasks marked with their owner`,
          url: `${ORIGIN}/tasks`,
        },
        {
          label: 'Take Kai’s MacBook offline (Studio keeps its tasks, marked with an offline icon)',
          url: `${ORIGIN}${SANDBOX_PATH}/teammate/offline`,
        },
        { label: 'Bring Kai’s MacBook back', url: `${ORIGIN}${SANDBOX_PATH}/teammate/online` },
        ...(teamTask
          ? [
              {
                label:
                  'One of Kai’s tasks on Studio as a full task page, through Studio’s relay (read-only while Kai’s MacBook is offline)',
                url: `http://${HOST}:${studioPort}${teamTask}`,
              },
              {
                label:
                  'Its Evidence shows Kai’s screenshot through the relay, and Open on its running web service goes to the service’s private address',
                url: `http://${HOST}:${studioPort}${teamTask}`,
              },
            ]
          : []),
        {
          label: `Studio: ${duplicate.duplicate}, closed as a duplicate of Kai’s task`,
          url: `http://${HOST}:${studioPort}/tasks/${duplicate.duplicate}`,
        },
        ...(duplicate.original
          ? [
              {
                label: `The remote dashboard: Kai’s ${duplicate.original} as a full task page, with Fork in its ••• menu`,
                url: `${ORIGIN}/tasks/${duplicate.original}`,
              },
              {
                label: `${teammate.name}’s own app, signed in as Kai: ${duplicate.original}, which shows the task kept over on Studio`,
                url: `http://${HOST}:${teammate.port}/tasks/${duplicate.original}`,
              },
            ]
          : []),
        {
          label: `${teammate.name}: Settings, Teams. Take Paywalls out of ${TEAM.name}, and Kai’s tasks leave Studio’s list at once`,
          url: `http://${HOST}:${teammate.port}/settings`,
        },
        {
          label:
            'The team’s join page (the dashboard now takes the team key from your own machines, so you no longer need it to open Kai’s tasks)',
          url: resolveTeamJoinUrl({ teamId: TEAM.id, invite: TEAM_INVITE, key: TEAM_KEY }, ORIGIN),
        },
      ],
    },
  ];
}
