import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  type SandboxSection,
  type ServicePreview,
  TEAM_INVITE,
} from './schema.ts';
import { createShareLink } from './shares.ts';
import { TEAM, TEAM_KEY } from './team.ts';

export function findRemoteStylesheet() {
  const html = readFileSync(join(REMOTE_WEB, 'index.html'), 'utf8');
  const href = /<link rel="stylesheet"[^>]*href="([^"]+\.css)"/.exec(html)?.[1];
  if (!href) throw new Error('The remote build has no stylesheet.');
  return href;
}

export function respondStatic(pathname: string) {
  const relative = pathname.replace(/^\/+/, '');
  const file = Bun.file(join(REMOTE_WEB, relative));
  if (relative && !relative.includes('..') && existsSync(join(REMOTE_WEB, relative)) && file.size > 0)
    return new Response(file);
  return new Response(Bun.file(join(REMOTE_WEB, 'index.html')), {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

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
          label: 'Studio: Settings, Teams, with Inês asking to join',
          url: `http://${HOST}:${studioPort}/settings`,
        },
        {
          label: 'Take Kai’s MacBook offline (Studio keeps its tasks as Offline)',
          url: `${ORIGIN}${SANDBOX_PATH}/teammate/offline`,
        },
        { label: 'Bring Kai’s MacBook back', url: `${ORIGIN}${SANDBOX_PATH}/teammate/online` },
        ...(teamTask
          ? [
              {
                label: 'One of Kai’s tasks on Studio, read-only',
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
                label: `${teammate.name}: ${duplicate.original}, which shows the task kept over on Studio`,
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
            'The team’s join link, which gives this browser the team key so the dashboard opens Kai’s tasks too',
          url: resolveTeamJoinUrl({ teamId: TEAM.id, invite: TEAM_INVITE, key: TEAM_KEY }, ORIGIN),
        },
      ],
    },
  ];
}
