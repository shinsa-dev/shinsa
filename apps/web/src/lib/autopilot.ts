import {
  type AutopilotContact,
  type AutopilotContactKind,
  type AutopilotGate,
  type AutopilotLevel,
  type AutoMerge,
  HOUR_MS,
  isSameAutopilotContact,
  MAX_AUTOPILOT_CONTACTS,
  type MergeBlock,
  MINUTE_MS,
  type AutopilotPolicy,
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

export const AUTOPILOT_OFF =
  'Approves and merges changes the reviewer is highly confident in. While it is off, every change waits for you.';

export const AUTOPILOT_TURN_ON = 'Turn on';

export const AUTOPILOT_ENABLED_ITEMS: SettingItem<'on' | 'off'>[] = [
  { value: 'off', label: 'Off', icon: 'IconCircleX' },
  { value: 'on', label: 'On', icon: 'IconRocket' },
];

export const AUTOPILOT_LEVEL_ITEMS: SettingItem<AutopilotLevel>[] = [
  {
    value: 'ask_first',
    label: 'Ask me first',
    icon: 'IconShieldCheck',
    hint: 'It acts alone only on small, low-risk work.',
  },
  {
    value: 'balanced',
    label: 'Balanced',
    icon: 'IconShieldCheck',
    hint: 'It acts alone on clear, low-risk work, and on medium risk when urgent.',
  },
  {
    value: 'most',
    label: 'Most things',
    icon: 'IconRocket',
    hint: 'It acts alone on medium-risk work, and on any urgent work once you are away.',
  },
];

export const AUTOPILOT_GATE_ROWS: { gate: AutopilotGate; title: string }[] = [
  { gate: 'plans', title: 'Plans' },
  { gate: 'questions', title: 'Agent questions' },
  { gate: 'reviews', title: 'Reviews' },
];

export const AUTOPILOT_GATE_ITEMS: SettingItem<'on' | 'off'>[] = [
  { value: 'on', label: 'Autopilot decides', icon: 'IconRocket' },
  { value: 'off', label: 'Always ask me', icon: 'IconCircleX' },
];

export function toggleAutopilotGate(gates: readonly AutopilotGate[], gate: AutopilotGate, on: boolean) {
  const others = gates.filter((saved) => saved !== gate);
  return on ? [...others, gate] : others;
}

export const AUTO_MERGE_ITEMS: SettingItem<AutoMerge>[] = [
  { value: 'off', label: 'Off, I merge', icon: 'IconCircleX' },
  { value: 'low_risk', label: 'Low risk changes', icon: 'IconMerged' },
  { value: 'approved', label: 'Every change it approved', icon: 'IconMerged' },
];

export const AUTOPILOT_ESCALATE_ITEMS: SettingItem<'on' | 'off'>[] = [
  {
    value: 'on',
    label: 'Only as a last resort',
    icon: 'IconMegaphone',
    hint: 'Only when you are away and the change is urgent and high risk.',
  },
  { value: 'off', label: 'Never', icon: 'IconCircleX' },
];

export const AUTOPILOT_BLOCKS = {
  acting: { title: 'Acting for you', icon: 'IconShieldCheck' },
  merging: { title: 'Merging', icon: 'IconMerged' },
  asks: { title: 'Who it asks', icon: 'IconMegaphone' },
} as const;

export const AUTOPILOT_ROWS = {
  level: 'On its own',
  autoMerge: 'Auto merge',
  escalate: 'Your team',
  usage: 'Usage limits',
} as const;

export const AUTOPILOT_USAGE_ITEMS: SettingItem<'on' | 'off'>[] = [
  { value: 'on', label: 'Ignore them', icon: 'IconRocket' },
  { value: 'off', label: 'Keep them', icon: 'IconCircleX' },
];

export function hasTeamProject(projects: readonly Pick<Project, 'teamIds'>[]) {
  return projects.some((project) => (project.teamIds?.length ?? 0) > 0);
}

export const TEAM_CONTACT = {
  title: 'Your team in Shinsa',
  shared: 'Always on',
  alone: 'No project shared with a team',
} as const;

export function isAskWaiting(policy: AutopilotPolicy, team: boolean) {
  return policy.escalate && !team && policy.contacts.length === 0;
}

const SLACK_CHECKING = 'Checking Slack';

export function resolveSlackUnavailable(
  available: boolean,
  { snapshot, failure }: { snapshot: SlackSnapshot | null; failure: string | null }
) {
  if (!available) return 'Update Shinsa on this machine first';
  if (!snapshot) return failure ? 'Slack could not be checked' : SLACK_CHECKING;
  if (!snapshot.remote || snapshot.links.length === 0) return 'Connect Slack in Settings → General first';
  return null;
}

export function resolveContactAddBlock(contacts: readonly AutopilotContact[], unavailable: string | null) {
  if (unavailable) return unavailable;
  return contacts.length >= MAX_AUTOPILOT_CONTACTS ? `Up to ${MAX_AUTOPILOT_CONTACTS} in Slack` : null;
}

export function resolveContactTestBlock(contacts: readonly AutopilotContact[], unavailable: string | null) {
  if (unavailable) return unavailable;
  return contacts.length === 0 ? 'Add a channel or person first' : null;
}

export function resolveContactWorkspace(snapshot: SlackSnapshot | null, chosen: string | null) {
  const links = snapshot?.links ?? [];
  if (chosen && links.some((link) => link.teamId === chosen)) return chosen;
  return links[0]?.teamId ?? null;
}

export function listSlackWorkspaceItems(snapshot: SlackSnapshot | null): SettingItem<string>[] {
  const items = new Map<string, SettingItem<string>>();
  for (const link of snapshot?.links ?? []) {
    items.set(link.teamId, { value: link.teamId, label: link.teamName, icon: 'IconSlack' });
  }
  return [...items.values()];
}

interface ContactOption {
  contact: AutopilotContact;
  chosen: boolean;
  disabled: boolean;
}

export interface ContactOptionGroup {
  kind: AutopilotContactKind;
  heading: string;
  options: ContactOption[];
}

const CONTACT_GROUPS: { kind: AutopilotContactKind; heading: string }[] = [
  { kind: 'slack_channel', heading: 'Channels' },
  { kind: 'slack_person', heading: 'People' },
];

export function listContactOptions(
  directory: SlackDirectoryView | null,
  contacts: readonly AutopilotContact[]
): ContactOptionGroup[] {
  if (!directory) return [];
  const full = contacts.length >= MAX_AUTOPILOT_CONTACTS;
  return CONTACT_GROUPS.flatMap(({ kind, heading }) => {
    const entries = kind === 'slack_channel' ? directory.channels : directory.people;
    const options = entries.map((entry) => {
      const image = kind === 'slack_person' && entry.image ? { image: entry.image } : {};
      const contact = { kind, teamId: directory.teamId, id: entry.id, name: entry.name, ...image };
      const chosen = contacts.some((saved) => isSameAutopilotContact(saved, contact));
      return { contact, chosen, disabled: full && !chosen };
    });
    return options.length === 0 ? [] : [{ kind, heading, options }];
  });
}

export function describeContactPickerEmpty(directory: SlackDirectoryView | null) {
  if (!directory) return 'Loading Slack…';
  if (directory.problem) return directory.problem;
  return 'Nothing matches.';
}

export const CONTACT_PICKER_HINT = 'Missing a channel? Invite @Shinsa to it in Slack.';

export function toggleAutopilotContact(contacts: readonly AutopilotContact[], contact: AutopilotContact) {
  if (contacts.some((saved) => isSameAutopilotContact(saved, contact))) {
    return contacts.filter((saved) => !isSameAutopilotContact(saved, contact));
  }
  return contacts.length >= MAX_AUTOPILOT_CONTACTS ? [...contacts] : [...contacts, contact];
}

export function describeAutopilotContact(contact: AutopilotContact, snapshot: SlackSnapshot | null) {
  const workspaces = listSlackWorkspaceItems(snapshot);
  const workspace = workspaces.find((item) => item.value === contact.teamId)?.label;
  return {
    title: contact.name,
    detail: workspaces.length > 1 && workspace ? workspace : null,
    removeLabel:
      contact.kind === 'slack_channel'
        ? `Stop posting in #${contact.name}`
        : `Stop messaging ${contact.name}`,
  };
}

export function isSlackTestSent(results: readonly { sent: boolean }[]) {
  return results.every((result) => result.sent);
}

export function describeSlackTestResults(
  results: readonly { contact: AutopilotContact; sent: boolean; problem: string | null }[]
) {
  const failed = results.find((result) => !result.sent);
  if (!failed) return results.length === 1 ? 'Sent a test to Slack' : `Sent ${results.length} tests to Slack`;
  const name = failed.contact.kind === 'slack_channel' ? `#${failed.contact.name}` : failed.contact.name;
  return `Not sent to ${name}: ${failed.problem ?? 'Slack refused it.'}`;
}

function describeMinutes(minutes: number) {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = minutes / 60;
  if (!Number.isInteger(hours)) return `${minutes} minutes`;
  return hours === 1 ? '1 hour' : `${hours} hours`;
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

function describeUrgentWait({ handoff }: TaskEscalation, owner: string) {
  if (handoff.waitedMinutes === 0) return `It is urgent and ready for ${owner} to merge`;
  return `It is urgent and waited ${describeMinutes(handoff.waitedMinutes)} for ${owner} to merge it`;
}

function describeWhy(escalation: TaskEscalation, viewer: HandoffViewer) {
  if (!viewer.owner) return `${describeUrgentWait(escalation, 'you')}, so Autopilot sent it to your team.`;
  const presence = describeOwnerPresence(escalation, viewer);
  const urgent = `${describeUrgentWait(escalation, viewer.owner)}.`;
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
  const minutes = escalation.handoff.waitedMinutes;
  if (minutes === 0) return `${owner}’s urgent fix${found} is ready to merge`;
  return `${owner}’s urgent fix${found} waited ${describeMinutes(minutes)} for its merge`;
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
