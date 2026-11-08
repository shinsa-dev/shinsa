import {
  type AutopilotContact,
  type AutopilotContactKind,
  type AutopilotMerge,
  type AutopilotSlackContact,
  type AutopilotSlackContactKind,
  HOUR_MS,
  type MergeBlock,
  MINUTE_MS,
  type AutopilotPolicy,
  type AutopilotRisk,
  type AutopilotUrgent,
  type Project,
  type ReviewRating,
  resolveAutopilotPolicy,
  type Settings,
  type SlackDirectoryView,
  type SlackSnapshot,
  type Task,
  type TaskEscalation,
  type TeamEscalation,
  type TeamPresenceStatus,
} from '@shinsa/core';
import { describeAgentReview } from '@/lib/review/report.ts';
import type { SettingItem } from '@/lib/settings.ts';
import { describeTeamTaskOwner, resolveTeamTaskPath, resolveTeamTaskTarget } from '@/lib/teams/feeds.ts';

export const AUTOPILOT_TITLE = 'Autopilot';

export const AUTOPILOT_DESCRIPTION =
  'Approves and merges a change for you when the reviewer is highly confident in it. Off, every change waits for you.';

export const AUTOPILOT_ENABLED_ITEMS: SettingItem<'on' | 'off'>[] = [
  { value: 'off', label: 'Off', icon: 'IconCircleX' },
  { value: 'on', label: 'On', icon: 'IconRocket' },
];

const RISK_LABEL: Record<AutopilotRisk, string> = {
  none: 'Never',
  low: 'Low risk only',
  medium: 'Up to medium risk',
  high: 'Any risk',
};

export const AUTOPILOT_RISK_ITEMS: SettingItem<AutopilotRisk>[] = (
  ['none', 'low', 'medium', 'high'] as const
).map((value) => ({
  value,
  label: RISK_LABEL[value],
  icon: value === 'none' ? 'IconCircleX' : 'IconShieldCheck',
}));

export const AUTOPILOT_MERGE_ITEMS: SettingItem<AutopilotMerge>[] = [
  { value: 'never', label: 'Never, ask me', icon: 'IconCircleX' },
  { value: 'low_risk', label: 'Low risk changes', icon: 'IconMerged' },
  { value: 'approved', label: 'Every change it approved', icon: 'IconMerged' },
];

export const AUTOPILOT_URGENT_ITEMS: SettingItem<AutopilotUrgent>[] = [
  { value: 'wait', label: 'Keep waiting for me', icon: 'IconClock' },
  { value: 'escalate', label: 'Send it to my team', icon: 'IconMegaphone' },
  { value: 'merge', label: 'Merge it for me', icon: 'IconMerged' },
  { value: 'escalate_then_merge', label: 'Send it to my team, then merge', icon: 'IconMegaphone' },
];

export const AUTOPILOT_ROWS = {
  approve: {
    title: 'Approve reviews for you',
    description:
      'A change the reviewer rated high confidence, up to this risk, goes to its pull request without you.',
  },
  urgentApprove: {
    title: 'Approve urgent reviews for you',
    description: 'The same, for a task marked urgent.',
  },
  merge: { title: 'Merge for you', description: 'Merges a pull request it approved once its checks pass.' },
  urgent: {
    title: 'When an urgent merge waits for you',
    description: 'Send it to my team puts it in your teammates’ Needs you and notifies each of them once.',
  },
  wait: { title: 'How long it waits for you', description: 'How long an urgent merge waits before it acts.' },
  contact: {
    title: 'Escalate to',
    description: 'Your team always sees it in Needs you. Slack gets the task link and why it needs someone.',
  },
  workspace: { title: 'Slack workspace', description: 'One of the workspaces you connected in Slack.' },
  slack_channel: {
    title: 'Channel',
    description: 'Only channels Shinsa is in are listed. Invite @Shinsa to a channel to add it.',
  },
  slack_person: { title: 'Teammate', description: 'They get a direct message from the Shinsa app.' },
  usage: {
    title: 'Ignore usage limits for urgent work',
    description: 'An urgent task keeps going past your daily, project and task limits.',
  },
} as const;

export const AUTOPILOT_USAGE_ITEMS: SettingItem<'on' | 'off'>[] = [
  { value: 'on', label: 'Ignore them', icon: 'IconRocket' },
  { value: 'off', label: 'Keep them', icon: 'IconCircleX' },
];

export const AUTOPILOT_NO_TEAM =
  'None of your projects is in a team yet, so only you see an urgent change it sends on.';

export function isEscalationUnseen(policy: AutopilotPolicy, projects: readonly Pick<Project, 'teamIds'>[]) {
  if (policy.urgent !== 'escalate' && policy.urgent !== 'escalate_then_merge') return false;
  return !projects.some((project) => (project.teamIds?.length ?? 0) > 0);
}

export function isContactShown(policy: AutopilotPolicy) {
  return policy.urgent === 'escalate' || policy.urgent === 'escalate_then_merge';
}

const CONTACT_ITEMS: Record<AutopilotContactKind, Omit<SettingItem<AutopilotContactKind>, 'value'>> = {
  team: { label: 'Your team in Shinsa', icon: 'IconUserDuo' },
  slack_channel: { label: 'Your team and a Slack channel', icon: 'IconHashtag' },
  slack_person: { label: 'Your team and a teammate on Slack', icon: 'IconSlack' },
};

export function resolveSlackUnavailable(
  available: boolean,
  { snapshot, failure }: { snapshot: SlackSnapshot | null; failure: string | null }
) {
  if (!available) return 'Update Shinsa on this machine first';
  if (!snapshot) return failure ? 'Slack could not be checked' : 'Checking Slack';
  if (!snapshot.remote || snapshot.links.length === 0) return 'Connect Slack in Settings → General first';
  return null;
}

export function listAutopilotContactItems(unavailable: string | null): SettingItem<AutopilotContactKind>[] {
  return (['team', 'slack_channel', 'slack_person'] as const).map((value) => ({
    value,
    ...CONTACT_ITEMS[value],
    ...(value !== 'team' && unavailable ? { disabled: unavailable } : {}),
  }));
}

export interface ContactDraft {
  kind: AutopilotContactKind;
  teamId: string | null;
}

export function resolveContactDraft(
  contact: AutopilotContact,
  draft: Partial<ContactDraft>,
  snapshot: SlackSnapshot | null
): ContactDraft {
  const saved = contact.kind === 'team' ? null : contact.teamId;
  const kind = draft.kind ?? contact.kind;
  if (kind === 'team') return { kind, teamId: null };
  return { kind, teamId: draft.teamId ?? saved ?? snapshot?.links[0]?.teamId ?? null };
}

export function listSlackWorkspaceItems(
  snapshot: SlackSnapshot | null,
  contact: AutopilotContact
): SettingItem<string>[] {
  const items = new Map<string, SettingItem<string>>();
  for (const link of snapshot?.links ?? []) {
    items.set(link.teamId, { value: link.teamId, label: link.teamName, icon: 'IconSlack' });
  }
  if (contact.kind !== 'team' && !items.has(contact.teamId)) {
    items.set(contact.teamId, {
      value: contact.teamId,
      label: contact.teamId,
      icon: 'IconSlack',
      disabled: 'Not connected any more',
    });
  }
  return [...items.values()];
}

export const NO_CONTACT = 'none';

const CONTACT_PLACEHOLDER: Record<AutopilotSlackContactKind, string> = {
  slack_channel: 'Choose a channel',
  slack_person: 'Choose a teammate',
};

const CONTACT_ICON: Record<AutopilotSlackContactKind, 'IconHashtag' | 'IconUser'> = {
  slack_channel: 'IconHashtag',
  slack_person: 'IconUser',
};

const EMPTY_DIRECTORY: Record<AutopilotSlackContactKind, string> = {
  slack_channel: 'Shinsa is in no channel yet',
  slack_person: 'No one to message yet',
};

export interface ContactPicker {
  items: SettingItem<string>[];
  value: string;
  description: string;
}

function listDirectoryEntries(directory: SlackDirectoryView, kind: AutopilotSlackContactKind) {
  return kind === 'slack_channel' ? directory.channels : directory.people;
}

function describePlaceholder(
  kind: AutopilotSlackContactKind,
  directory: SlackDirectoryView | null,
  count: number
) {
  if (!directory) return 'Loading';
  return count === 0 ? EMPTY_DIRECTORY[kind] : 'Not chosen yet';
}

export function resolveContactPicker(
  draft: { kind: AutopilotSlackContactKind; teamId: string },
  contact: AutopilotContact,
  directory: SlackDirectoryView | null
): ContactPicker {
  const icon = CONTACT_ICON[draft.kind];
  const saved = contact.kind === draft.kind && contact.teamId === draft.teamId ? contact : null;
  const entries = directory ? listDirectoryEntries(directory, draft.kind) : [];
  const items: SettingItem<string>[] = entries.map((entry) => ({ value: entry.id, label: entry.name, icon }));
  if (saved && !entries.some((entry) => entry.id === saved.id)) {
    items.unshift({ value: saved.id, label: saved.name, icon });
  }
  const placeholder: SettingItem<string> = {
    value: NO_CONTACT,
    label: CONTACT_PLACEHOLDER[draft.kind],
    icon,
    disabled: describePlaceholder(draft.kind, directory, entries.length),
  };
  return {
    items: saved ? items : [placeholder, ...items],
    value: saved?.id ?? NO_CONTACT,
    description: directory?.problem ?? AUTOPILOT_ROWS[draft.kind].description,
  };
}

export function resolveSlackContact(
  draft: { kind: AutopilotSlackContactKind; teamId: string },
  picker: ContactPicker,
  id: string
): AutopilotSlackContact | null {
  const item = picker.items.find((entry) => entry.value === id);
  if (!item || id === NO_CONTACT) return null;
  return { kind: draft.kind, teamId: draft.teamId, id, name: item.label };
}

const WAIT_CHOICES = [15, 30, 60, 120, 240, 480];

function describeMinutes(minutes: number) {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = minutes / 60;
  if (!Number.isInteger(hours)) return `${minutes} minutes`;
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

export function listAutopilotWaitItems(policy: AutopilotPolicy): SettingItem<string>[] {
  const values = [...new Set([...WAIT_CHOICES, policy.urgentWaitMinutes])].sort((a, b) => a - b);
  return values.map((value) => ({ value: String(value), label: describeMinutes(value), icon: 'IconClock' }));
}

export function resolveAutopilotValue(settings: Settings) {
  const policy = resolveAutopilotPolicy(settings);
  return { policy, enabled: policy.enabled ? ('on' as const) : ('off' as const) };
}

type RatingTone = 'green' | 'amber' | 'red';

interface RatingBadge {
  key: 'confidence' | 'risk';
  label: string;
  tone: RatingTone;
  icon: 'IconEyeSparkle' | 'IconShieldCheck';
}

const CONFIDENCE_TONE: Record<ReviewRating, RatingTone> = { high: 'green', medium: 'amber', low: 'red' };
const RISK_TONE: Record<ReviewRating, RatingTone> = { low: 'green', medium: 'amber', high: 'red' };

export interface ReviewRatingsView {
  badges: [RatingBadge, RatingBadge];
  hint: string | null;
}

function describeRatingsHint(task: Pick<Task, 'reviewRatings' | 'autopiloted'>) {
  if (task.autopiloted) return 'Autopilot approved it for you.';
  const ratings = task.reviewRatings;
  if (ratings?.confidence === 'high' && ratings.risk === 'low') {
    return 'The reviewer is confident and sees little risk, so a quick read should do.';
  }
  if (ratings?.confidence === 'low' || ratings?.risk === 'high')
    return 'The reviewer suggests a careful read.';
  return null;
}

export function resolveReviewRatingsView(
  task: Pick<Task, 'reviewRatings' | 'autopiloted'>
): ReviewRatingsView | null {
  const ratings = task.reviewRatings;
  if (!ratings) return null;
  return {
    badges: [
      {
        key: 'confidence',
        label: `${capitalize(ratings.confidence)} confidence`,
        tone: CONFIDENCE_TONE[ratings.confidence],
        icon: 'IconEyeSparkle',
      },
      {
        key: 'risk',
        label: `${capitalize(ratings.risk)} risk`,
        tone: RISK_TONE[ratings.risk],
        icon: 'IconShieldCheck',
      },
    ],
    hint: describeRatingsHint(task),
  };
}

function capitalize(word: string) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function describeAgentReviewNote(task: Pick<Task, 'findings' | 'autopiloted'>) {
  const verdict = task.autopiloted
    ? 'Autopilot approved it for you.'
    : 'A signal for you, never the approval.';
  return `${describeAgentReview(task.findings)} ${verdict}`;
}

export function resolveAutopilotFact(task: Pick<Task, 'autopiloted'>) {
  if (!task.autopiloted) return null;
  return { label: 'Approved for you', hint: `Autopilot approved the review: ${task.autopiloted.reason}` };
}

export function resolveEscalationFact(task: Pick<Task, 'escalation'>) {
  if (!task.escalation) return null;
  return { label: 'Sent to your team', hint: `Autopilot sent it to your team: ${task.escalation.reason}` };
}

export const TEAM_ESCALATIONS_TITLE = 'Sent by your team';

export const HANDOFF_TITLE: Record<'owner' | 'teammate', string> = {
  owner: 'Sent to your team',
  teammate: 'Why this reached you',
};

const PRESENCE_TEXT: Record<TeamPresenceStatus, string> = {
  online: 'is online now',
  away: 'is away',
  offline: 'is offline',
};

const LAST_SEEN: Record<TeamPresenceStatus, string | null> = {
  online: null,
  away: 'was last active',
  offline: 'was last online',
};

function describeHoursAgo(at: number, now: number) {
  const hours = Math.floor((now - at) / HOUR_MS);
  if (hours < 1) return 'within the last hour';
  if (hours < 48) return hours === 1 ? 'about an hour ago' : `about ${hours} hours ago`;
  return `about ${Math.floor(hours / 24)} days ago`;
}

function describeIn(at: number, now: number) {
  const minutes = Math.max(1, Math.round((at - now) / MINUTE_MS));
  return minutes < 90 ? `in ${describeMinutes(minutes)}` : `in about ${Math.round(minutes / 60)} hours`;
}

export interface HandoffViewer {
  owner: string | null;
  presence: TeamPresenceStatus | null;
  now: number;
}

export interface HandoffParagraph {
  label: string;
  text: string;
}

function describeOwnerPresence({ handoff }: TaskEscalation, { owner, presence, now }: HandoffViewer) {
  if (!owner) return null;
  const ago = handoff.ownerActiveAt === null ? null : describeHoursAgo(handoff.ownerActiveAt, now);
  if (presence) {
    const seen = LAST_SEEN[presence];
    return seen && ago
      ? `${owner} ${PRESENCE_TEXT[presence]} and ${seen} ${ago}.`
      : `${owner} ${PRESENCE_TEXT[presence]}.`;
  }
  return ago ? `${owner} was last online ${ago}.` : null;
}

function describeWhy(escalation: TaskEscalation, viewer: HandoffViewer) {
  const waited = describeMinutes(escalation.handoff.waitedMinutes);
  if (!viewer.owner)
    return `It is urgent and waited ${waited} for you to merge it, so Autopilot sent it to your team.`;
  const presence = describeOwnerPresence(escalation, viewer);
  const urgent = `It is urgent and waited ${waited} for ${viewer.owner} to merge it.`;
  return presence ? `${urgent} ${presence}` : urgent;
}

function describeFix({ handoff }: TaskEscalation) {
  const found = handoff.foundBy;
  const where = found?.server ? ` in ${found.server}` : '';
  const after = found?.shippedTaskTitle ? ` after “${found.shippedTaskTitle}” shipped` : '';
  const finder = found ? `A watchdog found an issue${where}${after}, and this change fixes it.` : null;
  const ratings = handoff.ratings
    ? `The reviewer rated the fix ${handoff.ratings.confidence} confidence, ${handoff.ratings.risk} risk.`
    : null;
  const text = [finder, ratings].filter((sentence) => sentence !== null).join(' ');
  return text || null;
}

const MERGE_BLOCK_TEXT: Record<MergeBlock, (owner: string | null) => string> = {
  self_approved: (owner) =>
    `${owner ?? 'you'} approved the review by hand, so it waits for a person to merge it.`,
  pre_merge_steps: () => 'a pre-merge step is not ticked yet.',
  edits_not_pushed: (owner) => `${owner ? `${owner}’s` : 'your'} edits are not pushed yet.`,
};

function describeAutopilotNext({ handoff }: TaskEscalation, { owner, now }: HandoffViewer) {
  if (handoff.blockedBy) return `Autopilot could not merge it: ${MERGE_BLOCK_TEXT[handoff.blockedBy](owner)}`;
  if (handoff.mergesAt !== null && handoff.mergesAt > now) {
    return `Autopilot merges it ${describeIn(handoff.mergesAt, now)} unless someone acts first.`;
  }
  return null;
}

function describeNext(escalation: TaskEscalation, viewer: HandoffViewer) {
  const ask = viewer.owner
    ? `Review the change and merge it if your team settings let you, or reach ${viewer.owner}.`
    : 'Your teammates see it in their Needs you until it merges.';
  const autopilot = describeAutopilotNext(escalation, viewer);
  return autopilot ? `${ask} ${autopilot}` : ask;
}

export function listHandoffParagraphs(escalation: TaskEscalation, viewer: HandoffViewer): HandoffParagraph[] {
  const teammate = viewer.owner !== null;
  const fix = describeFix(escalation);
  return [
    {
      label: teammate ? 'Why it reached you' : 'Why your team has it',
      text: describeWhy(escalation, viewer),
    },
    ...(fix ? [{ label: 'What it fixes', text: fix }] : []),
    { label: teammate ? 'What to do now' : 'What happens now', text: describeNext(escalation, viewer) },
  ];
}

export function describeTeamEscalationSummary({ entry, escalation }: TeamEscalation) {
  const owner = describeTeamTaskOwner(entry);
  const found = escalation.handoff.foundBy ? ', found by a watchdog,' : '';
  return `${owner}’s urgent fix${found} waited ${describeMinutes(escalation.handoff.waitedMinutes)} for its merge`;
}

export interface TeamEscalationRow {
  key: string;
  title: string;
  summary: string;
  since: number;
  path: string;
}

export function listTeamEscalationRows(escalations: readonly TeamEscalation[]): TeamEscalationRow[] {
  return escalations.map((item) => ({
    key: `${item.entry.instanceId} ${item.entry.task.id}`,
    title: item.entry.task.title,
    summary: describeTeamEscalationSummary(item),
    since: item.escalation.at,
    path: resolveTeamTaskPath(resolveTeamTaskTarget(item.entry)),
  }));
}
