import { TASK_PRIORITIES, type TaskPriority, type TaskStage } from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import type { Tone } from '@/lib/format/tone.ts';

export const STAGE_LABEL: Record<TaskStage, string> = {
  triage: 'Starting',
  queued: 'Not started',
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
  awaiting_proposal: 'Change to approve',
  awaiting_operation: 'Operation to confirm',
  merged: 'Merged',
  done: 'Done',
  cancelled: 'Cancelled',
};

export const STAGE_TONE: Record<TaskStage, Tone> = {
  triage: 'neutral',
  queued: 'neutral',
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
  awaiting_proposal: 'purple',
  awaiting_operation: 'purple',
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
