import {
  type AutopilotMerge,
  type AutopilotPolicy,
  type AutopilotRisk,
  type AutopilotUrgent,
  type Project,
  type ReviewRating,
  resolveAutopilotPolicy,
  type Settings,
  type Task,
  type TeamEscalation,
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

export type RatingTone = 'green' | 'amber' | 'red';

export interface RatingBadge {
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

export const TEAM_ESCALATIONS_TITLE = 'Sent to your team';

export interface TeamEscalationRow {
  key: string;
  title: string;
  summary: string;
  since: number;
  path: string;
}

export function listTeamEscalationRows(escalations: readonly TeamEscalation[]): TeamEscalationRow[] {
  return escalations.map(({ entry, escalation }) => ({
    key: `${entry.instanceId} ${entry.task.id}`,
    title: entry.task.title,
    summary: `${describeTeamTaskOwner(entry)}’s urgent change is waiting for its merge`,
    since: escalation.at,
    path: resolveTeamTaskPath(resolveTeamTaskTarget(entry)),
  }));
}
