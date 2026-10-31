import type { SlackLink, SlackSnapshot } from '@shinsa/core';
import { formatSince } from '@/lib/format/time.ts';
import type { Tone } from '@/lib/format/tone.ts';
import { MACHINE_ICON, type RemotePoint } from '@/lib/remote/mode.ts';

export const SLACK_SECTION = 'Slack';

export const SLACK_DESCRIPTION =
  'Mention @Shinsa in a Slack channel or thread to start a task on this machine. Its questions, plan, review and result come back in the thread; you still decide in Shinsa.';

export const SLACK_ON_MACHINE_NOTE = 'Disconnect is in Settings on the machine itself.';

const SLACK_LINKED_ERRORS: Record<string, string> = {
  slack_denied: 'Slack was not connected because the request was turned down there.',
  slack_expired: 'Connecting took longer than 10 minutes. Start again from Settings on your machine.',
  slack_failed: 'Slack did not finish connecting. Try again in a minute.',
  signed_out: 'You were signed out of app.shinsa.dev while connecting. Sign in and start again.',
  not_found: 'That machine is not one of yours. Connect from Settings on the machine itself.',
  no_machine: 'Your account has no machine yet. Turn on remote access on a machine first.',
};

const UNKNOWN_LINKED_ERROR = 'Slack could not be connected. Try again from Settings on your machine.';

export interface SlackStatusView {
  label: string;
  tone: Tone;
  detail: string;
}

export function describeSlackStatus(snapshot: SlackSnapshot): SlackStatusView {
  if (!snapshot.remote)
    return {
      label: 'Needs remote access',
      tone: 'neutral',
      detail: 'Slack reaches this machine through remote access. Turn it on above first.',
    };
  if (snapshot.problem) return { label: 'Unknown', tone: 'amber', detail: snapshot.problem };
  if (snapshot.links.length === 0)
    return {
      label: 'Not connected',
      tone: 'neutral',
      detail: 'Connect signs you in with Slack and adds Shinsa to your workspace if it is not there yet.',
    };
  const workspaces = snapshot.links.length === 1 ? 'workspace' : 'workspaces';
  return {
    label: 'Connected',
    tone: 'green',
    detail: `Only your own mentions start tasks here, in ${snapshot.links.length} ${workspaces}.`,
  };
}

export function describeSlackLink(link: SlackLink, now = Date.now()) {
  return `${formatSince('Connected', link.linkedAt, now)} as ${link.userName}`;
}

export const SLACK_POINTS: RemotePoint[] = [
  {
    icon: 'IconBubbleText',
    title: 'Mention @Shinsa',
    detail: 'In a channel or a thread, with what you want done. A bare mention under a bug report is enough.',
  },
  {
    icon: MACHINE_ICON,
    title: 'It runs on your machine',
    detail: 'The thread becomes a task, just like one typed on Home, with its project picked for you.',
  },
  {
    icon: 'IconShieldCheck',
    title: 'You decide in Shinsa',
    detail:
      'Questions, the plan, the review and the result come back in the thread. Approving stays in Shinsa.',
  },
];

export type SlackLinkedResult = { kind: 'linked'; team: string } | { kind: 'failed'; message: string };

export function resolveSlackLinkedResult(search: string): SlackLinkedResult {
  const params = new URLSearchParams(search);
  const team = params.get('team');
  if (team) return { kind: 'linked', team };
  return { kind: 'failed', message: SLACK_LINKED_ERRORS[params.get('error') ?? ''] ?? UNKNOWN_LINKED_ERROR };
}
