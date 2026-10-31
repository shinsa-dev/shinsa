import { describe, expect, it } from 'bun:test';
import type { SlackSnapshot } from '@shinsa/core';
import { describeSlackLink, describeSlackStatus, resolveSlackLinkedResult } from '@/lib/slack.ts';

const LINK = { teamId: 'T1', teamName: 'Overclock', userId: 'U1', userName: 'Christo', linkedAt: 0 };

function snapshot(overrides: Partial<SlackSnapshot> = {}): SlackSnapshot {
  return {
    remote: true,
    connectUrl: 'https://app.shinsa.dev/slack/connect',
    links: [],
    problem: null,
    ...overrides,
  };
}

describe('Slack’s status in Settings', () => {
  it('asks for remote access first, since Slack reaches this machine through it', () => {
    expect(describeSlackStatus(snapshot({ remote: false }))).toEqual({
      label: 'Needs remote access',
      tone: 'neutral',
      detail: 'Slack reaches this machine through remote access. Turn it on above first.',
    });
  });

  it('says it cannot tell when app.shinsa.dev does not answer', () => {
    expect(describeSlackStatus(snapshot({ problem: 'app.shinsa.dev could not be reached.' }))).toMatchObject({
      label: 'Unknown',
      tone: 'amber',
      detail: 'app.shinsa.dev could not be reached.',
    });
  });

  it('is not connected until a Slack account is linked, then counts its workspaces', () => {
    expect(describeSlackStatus(snapshot()).label).toBe('Not connected');
    expect(describeSlackStatus(snapshot({ links: [LINK] }))).toMatchObject({
      label: 'Connected',
      tone: 'green',
      detail: 'Only your own mentions start tasks here, in 1 workspace.',
    });
    expect(describeSlackStatus(snapshot({ links: [LINK, { ...LINK, teamId: 'T2' }] })).detail).toBe(
      'Only your own mentions start tasks here, in 2 workspaces.'
    );
  });

  it('names who each workspace is connected as and since when', () => {
    expect(describeSlackLink({ ...LINK, linkedAt: 1_000 }, 1_000 + 2 * 3_600_000)).toBe(
      'Connected 2h ago as Christo'
    );
  });
});

describe('the page after connecting Slack', () => {
  it('names the workspace it connected', () => {
    expect(resolveSlackLinkedResult('?team=Overclock')).toEqual({ kind: 'linked', team: 'Overclock' });
  });

  it('says why it failed, in words, for every reason the relay gives and any other', () => {
    expect(resolveSlackLinkedResult('?error=slack_expired')).toEqual({
      kind: 'failed',
      message: 'Connecting took longer than 10 minutes. Start again from Settings on your machine.',
    });
    expect(resolveSlackLinkedResult('?error=something_new')).toEqual({
      kind: 'failed',
      message: 'Slack could not be connected. Try again from Settings on your machine.',
    });
    expect(resolveSlackLinkedResult('').kind).toBe('failed');
  });
});
