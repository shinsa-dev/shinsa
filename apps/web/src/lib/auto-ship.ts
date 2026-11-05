import {
  type AutoShipMerge,
  type AutoShipPolicy,
  type AutoShipRisk,
  type AutoShipUrgent,
  type ReviewRatings,
  resolveAutoShipPolicy,
  type Settings,
  type Task,
  type TeamEscalation,
} from '@shinsa/core';
import { describeAgentReview } from '@/lib/review/report.ts';
import type { SettingItem } from '@/lib/settings.ts';
import { describeTeamTaskOwner, resolveTeamTaskPath, resolveTeamTaskTarget } from '@/lib/teams/feeds.ts';

export const AUTO_SHIP_TITLE = 'Auto-ship';

export const AUTO_SHIP_DESCRIPTION =
  'Approves and merges a change for you when the reviewer is highly confident in it. Off, every change waits for you.';

export const AUTO_SHIP_ENABLED_ITEMS: SettingItem<'on' | 'off'>[] = [
  { value: 'off', label: 'Off', icon: 'IconCircleX' },
  { value: 'on', label: 'On', icon: 'IconRocket' },
];

const RISK_LABEL: Record<AutoShipRisk, string> = {
  none: 'Never',
  low: 'Low risk only',
  medium: 'Up to medium risk',
  high: 'Any risk',
};

export const AUTO_SHIP_RISK_ITEMS: SettingItem<AutoShipRisk>[] = (
  ['none', 'low', 'medium', 'high'] as const
).map((value) => ({
  value,
  label: RISK_LABEL[value],
  icon: value === 'none' ? 'IconCircleX' : 'IconShieldCheck',
}));

export const AUTO_SHIP_MERGE_ITEMS: SettingItem<AutoShipMerge>[] = [
  { value: 'never', label: 'Never, ask me', icon: 'IconCircleX' },
  { value: 'low_risk', label: 'Low risk changes', icon: 'IconMerged' },
  { value: 'approved', label: 'Every change it approved', icon: 'IconMerged' },
];

export const AUTO_SHIP_URGENT_ITEMS: SettingItem<AutoShipUrgent>[] = [
  { value: 'wait', label: 'Keep waiting for me', icon: 'IconClock' },
  { value: 'escalate', label: 'Send it to my team', icon: 'IconMegaphone' },
  { value: 'merge', label: 'Merge it for me', icon: 'IconMerged' },
  { value: 'escalate_then_merge', label: 'Send it to my team, then merge', icon: 'IconMegaphone' },
];

const WAIT_CHOICES = [15, 30, 60, 120, 240, 480];

function describeMinutes(minutes: number) {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = minutes / 60;
  if (!Number.isInteger(hours)) return `${minutes} minutes`;
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

export function listAutoShipWaitItems(policy: AutoShipPolicy): SettingItem<string>[] {
  const values = [...new Set([...WAIT_CHOICES, policy.urgentWaitMinutes])].sort((a, b) => a - b);
  return values.map((value) => ({ value: String(value), label: describeMinutes(value), icon: 'IconClock' }));
}

export function resolveAutoShipValue(settings: Settings) {
  const policy = resolveAutoShipPolicy(settings);
  return { policy, enabled: policy.enabled ? ('on' as const) : ('off' as const) };
}

export function describeReviewRatings(ratings: ReviewRatings | null | undefined) {
  if (!ratings) return null;
  return `Rated ${ratings.confidence} confidence, ${ratings.risk} risk.`;
}

export function describeAgentReviewNote(task: Pick<Task, 'findings' | 'reviewRatings' | 'autoShipped'>) {
  const verdict = task.autoShipped
    ? 'Auto-ship approved it for you.'
    : 'A signal for you, never the approval.';
  return [describeAgentReview(task.findings), describeReviewRatings(task.reviewRatings), verdict]
    .filter(Boolean)
    .join(' ');
}

export function resolveAutoShipFact(task: Pick<Task, 'autoShipped'>) {
  if (!task.autoShipped) return null;
  return { label: 'Approved for you', hint: `Auto-ship approved the review: ${task.autoShipped.reason}` };
}

export function resolveEscalationFact(task: Pick<Task, 'escalation'>) {
  if (!task.escalation) return null;
  return { label: 'Sent to your team', hint: `Auto-ship sent it to your team: ${task.escalation.reason}` };
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
