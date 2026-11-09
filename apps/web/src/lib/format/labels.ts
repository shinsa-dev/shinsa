import { type GateType, TASK_PRIORITIES, type TaskPriority, type TaskStage } from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import type { Tone } from '@/lib/format/tone.ts';

export const STAGE_LABEL: Record<TaskStage, string> = {
  triage: 'Starting',
  waiting_on_tasks: 'Not started',
  planning: 'Planning',
  awaiting_plan: 'Plan to approve',
  building: 'Building',
  checking: 'Checking',
  reviewing: 'Agent review',
  fixing: 'Fixing',
  awaiting_review: 'Changes to review',
  shipping: 'Pull request',
  awaiting_merge: 'Ready to merge',
  answering: 'Answering',
  investigating: 'Investigating',
  researching: 'Researching',
  operating: 'Running the operation',
  watching: 'Checking a watchdog',
  leading: 'Leading an initiative',
  awaiting_proposal: 'Change to approve',
  awaiting_operation: 'Operation to confirm',
  answered: 'Answered',
  merged: 'Merged',
  done: 'Done',
  cancelled: 'Cancelled',
};

export const STAGE_TONE: Record<TaskStage, Tone> = {
  triage: 'neutral',
  waiting_on_tasks: 'neutral',
  planning: 'blue',
  awaiting_plan: 'purple',
  building: 'blue',
  checking: 'blue',
  reviewing: 'blue',
  fixing: 'blue',
  awaiting_review: 'amber',
  shipping: 'blue',
  awaiting_merge: 'green',
  answering: 'blue',
  investigating: 'blue',
  researching: 'blue',
  operating: 'blue',
  watching: 'blue',
  leading: 'blue',
  awaiting_proposal: 'purple',
  awaiting_operation: 'purple',
  answered: 'blue',
  merged: 'neutral',
  done: 'neutral',
  cancelled: 'neutral',
};

export const STAGE_ICON: Partial<Record<TaskStage, IconName>> = {
  triage: 'IconMagnifyingGlass',
  planning: 'IconLightbulbGlow',
  building: 'IconHammer',
  checking: 'IconShieldCheck',
  shipping: 'IconRocket',
  answering: 'IconBubbleText',
  investigating: 'IconMagnifyingGlass',
  researching: 'IconBook',
  operating: 'IconConsole',
  watching: 'IconRadar',
};

const QUESTION_GATE = { label: 'Needs your answer', icon: 'IconBubbleQuestion', tone: 'blue' } as const;

export const GATE: Record<GateType, { label: string; icon: IconName; tone: Tone }> = {
  plan: { label: 'Plan to approve', icon: 'IconFileText', tone: 'purple' },
  review: { label: 'Changes to review', icon: 'IconEyeOpen', tone: 'amber' },
  merge: { label: 'Ready to merge', icon: 'IconMerged', tone: 'green' },
  question: QUESTION_GATE,
  secret: QUESTION_GATE,
  proposal: { label: 'Change to approve', icon: 'IconFileEdit', tone: 'purple' },
  operation: { label: 'Operation to confirm', icon: 'IconConsole', tone: 'purple' },
  failure: { label: 'Paused', icon: 'IconPause', tone: 'orange' },
  configuration: { label: 'Setup incomplete', icon: 'IconToolbox', tone: 'orange' },
  sign_in: { label: 'Sign in needed', icon: 'IconUserKey', tone: 'orange' },
  post_merge: { label: 'Post-merge', icon: 'IconChecklist', tone: 'amber' },
  result: { label: 'Answered', icon: 'IconBubbleCheck', tone: 'blue' },
};

export const AGENT_STAGES: ReadonlySet<TaskStage> = new Set<TaskStage>([
  'triage',
  'planning',
  'building',
  'checking',
  'reviewing',
  'fixing',
  'shipping',
  'answering',
  'investigating',
  'researching',
  'operating',
]);

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};

export const PRIORITY_ICON: Record<TaskPriority, { name: IconName; className?: string }> = {
  urgent: { name: 'IconPriorityUrgent', className: 'text-red-4' },
  high: { name: 'IconPriorityHigh' },
  normal: { name: 'IconPriorityMedium' },
  low: { name: 'IconPriorityLow' },
};

export function listPriorityItems() {
  return TASK_PRIORITIES.map((priority) => ({
    value: priority,
    label: priority === 'urgent' ? PRIORITY_LABEL[priority] : `${PRIORITY_LABEL[priority]} priority`,
    icon: PRIORITY_ICON[priority],
  }));
}
