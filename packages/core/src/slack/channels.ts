import type { ScheduleTrigger } from '../domain/index.ts';
import type { SlackChannelRequest } from '../schedules/validate.ts';
import type { ShinsaState } from '../state/index.ts';
import type { SlackChannel, SlackChannelWatch } from './schema.ts';

export type SlackChannelTrigger = Extract<ScheduleTrigger, { kind: 'slack' }>;

export type SlackChannelResolution =
  | { trigger: SlackChannelTrigger; problem: null }
  | { trigger: null; problem: string };

export const SLACK_NOT_CONNECTED =
  'Slack is not connected to this machine. Turn on remote access and connect Slack in Settings → General → Slack, invite @Shinsa to the channel, then set the automation again.';

function isNamed(value: string, id: string, name: string) {
  return value === id.toLowerCase() || value === name.toLowerCase();
}

export function resolveSlackChannelTrigger(
  channels: readonly SlackChannel[],
  choice: SlackChannelRequest
): SlackChannelResolution {
  if (channels.length === 0)
    return {
      trigger: null,
      problem: `Shinsa is in no channel of a Slack workspace connected to this machine. Connect Slack in Settings → General → Slack if it is not connected yet, invite @Shinsa to #${choice.channel} in Slack, then set the automation again.`,
    };
  const channel = choice.channel.toLowerCase();
  const workspace = choice.workspace?.toLowerCase() ?? null;
  const matches = channels.filter(
    (candidate) =>
      isNamed(channel, candidate.channelId, candidate.channelName) &&
      (workspace === null || isNamed(workspace, candidate.teamId, candidate.teamName))
  );
  const [match] = matches;
  if (!match) {
    const where = choice.workspace ? ` in ${choice.workspace}` : '';
    return {
      trigger: null,
      problem: `Shinsa is not in #${choice.channel}${where}. Invite @Shinsa to the channel in Slack, then set the automation again.`,
    };
  }
  if (matches.length > 1) {
    const names = matches.map((candidate) => candidate.teamName).join(', ');
    return {
      trigger: null,
      problem: `#${match.channelName} is in several Slack workspaces: ${names}. Name the workspace too.`,
    };
  }
  return {
    trigger: {
      kind: 'slack',
      teamId: match.teamId,
      teamName: match.teamName.trim(),
      channelId: match.channelId,
      channelName: match.channelName.trim(),
    },
    problem: null,
  };
}

export function listSlackChannelWatches(state: ShinsaState): SlackChannelWatch[] {
  const watches = new Map<string, SlackChannelWatch>();
  for (const schedule of Object.values(state.schedules)) {
    const { trigger } = schedule;
    if (trigger.kind !== 'slack' || !schedule.enabled) continue;
    watches.set(`${trigger.teamId}:${trigger.channelId}`, {
      teamId: trigger.teamId,
      channelId: trigger.channelId,
    });
  }
  return [...watches.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, watch]) => watch);
}

export function listSlackChannelSchedules(
  state: ShinsaState,
  message: { readonly teamId: string; readonly channelId: string }
) {
  return Object.values(state.schedules).filter(
    ({ trigger, enabled }) =>
      enabled &&
      trigger.kind === 'slack' &&
      trigger.teamId === message.teamId &&
      trigger.channelId === message.channelId
  );
}
