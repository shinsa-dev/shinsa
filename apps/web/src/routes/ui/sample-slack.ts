import type { SlackSnapshot } from '@shinsa/core';

const CONNECT_URL = 'https://app.shinsa.dev/slack/connect?instance=k3x9m2p7q1zt';

const HOUR_MS = 60 * 60 * 1000;

export function createSampleSlack(now: number): { label: string; snapshot: SlackSnapshot }[] {
  return [
    {
      label: 'SlackGroup · remote access is off, so Slack cannot reach this machine yet',
      snapshot: { remote: false, connectUrl: null, links: [], problem: null },
    },
    {
      label: 'SlackGroup · remote access on, Slack not connected',
      snapshot: { remote: true, connectUrl: CONNECT_URL, links: [], problem: null },
    },
    {
      label: 'SlackGroup · connected in two workspaces',
      snapshot: {
        remote: true,
        connectUrl: CONNECT_URL,
        links: [
          {
            teamId: 'T1',
            teamName: 'Overclock',
            userId: 'U1',
            userName: 'Christo',
            linkedAt: now - 3 * 24 * HOUR_MS,
          },
          {
            teamId: 'T2',
            teamName: 'Superwall',
            userId: 'U7',
            userName: 'christo',
            linkedAt: now - 2 * HOUR_MS,
          },
        ],
        problem: null,
      },
    },
    {
      label: 'SlackGroup · app.shinsa.dev cannot be reached',
      snapshot: {
        remote: true,
        connectUrl: CONNECT_URL,
        links: [],
        problem:
          'app.shinsa.dev could not be reached, so Shinsa cannot say which Slack accounts are connected.',
      },
    },
  ];
}
