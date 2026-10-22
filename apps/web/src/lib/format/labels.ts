import type { TaskPriority, TaskStage } from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import type { Tone } from './tone.ts';

export const STAGE_LABEL: Record<TaskStage, string> = {
  triage: 'Starting',
  queued: 'Not started',
  planning: 'Planning',
  awaiting_spec: 'Plan to approve',
  building: 'Building',
  checking: 'Checking',
  reviewing: 'Agent review',
  fixing: 'Fixing',
  awaiting_review: 'Changes to review',
  shipping: 'Pull request',
  awaiting_merge: 'Ready to merge',
  merged: 'Merged',
  done: 'Done',
  cancelled: 'Cancelled',
};

export const STAGE_TONE: Record<TaskStage, Tone> = {
  triage: 'neutral',
  queued: 'neutral',
  planning: 'blue',
  awaiting_spec: 'purple',
  building: 'blue',
  checking: 'blue',
  reviewing: 'blue',
  fixing: 'blue',
  awaiting_review: 'amber',
  shipping: 'blue',
  awaiting_merge: 'green',
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
};

export const WORKING_STAGES: ReadonlySet<TaskStage> = new Set<TaskStage>([
  'triage',
  'planning',
  'building',
  'checking',
  'reviewing',
  'fixing',
  'shipping',
]);

export const PRIORITIES: TaskPriority[] = ['urgent', 'high', 'normal', 'low'];

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};

export const PRIORITY_ICON: Record<TaskPriority, { name: IconName; className: string }> = {
  urgent: { name: 'IconPriorityUrgent', className: 'opacity-100 text-red-4' },
  high: { name: 'IconPriorityHigh', className: 'opacity-100' },
  normal: { name: 'IconPriorityMedium', className: 'opacity-100' },
  low: { name: 'IconPriorityLow', className: 'opacity-100' },
};
