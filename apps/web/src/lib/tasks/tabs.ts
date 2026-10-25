import { hasStep, type Task, type TaskStage } from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import type { CodeMode } from '@/lib/code/location.ts';

export type TaskTab = 'overview' | 'review' | 'code' | 'chat';

export type ExplorerMode = Exclude<CodeMode, 'search'>;

export const TASK_TAB: Record<TaskTab, { label: string; icon: IconName }> = {
  overview: { label: 'Overview', icon: 'IconHomeRoundDoor' },
  review: { label: 'Review', icon: 'IconEyeOpen' },
  code: { label: 'Code', icon: 'IconCode' },
  chat: { label: 'Chat', icon: 'IconBubbleText' },
};

export const CODE_MODE: Record<CodeMode, { label: string; icon: IconName }> = {
  changes: { label: 'Changes', icon: 'IconDifferenceModified' },
  files: { label: 'Files', icon: 'IconFiles' },
  search: { label: 'Search', icon: 'IconMagnifyingGlass' },
};

const REVIEWED: ReadonlySet<TaskStage> = new Set<TaskStage>([
  'awaiting_review',
  'shipping',
  'awaiting_merge',
  'merged',
  'done',
]);

const BEFORE_CODE: ReadonlySet<TaskStage> = new Set<TaskStage>([
  'triage',
  'waiting_on_tasks',
  'planning',
  'awaiting_plan',
  'answering',
  'investigating',
  'researching',
  'awaiting_proposal',
]);

export function hasChanges(task: Task) {
  if (!hasStep(task, 'build')) return false;
  return task.report !== null || !BEFORE_CODE.has(task.stage);
}

export function hasReview(task: Task) {
  if (!hasChanges(task)) return false;
  return task.report !== null || task.findings.length > 0 || REVIEWED.has(task.stage);
}

export function listCodeModes(task: Task): ExplorerMode[] {
  return hasChanges(task) ? ['changes', 'files'] : ['files'];
}

export function listTaskTabs(task: Task): TaskTab[] {
  const tabs: TaskTab[] = ['overview'];
  if (hasReview(task)) tabs.push('review');
  if (task.repoId || hasChanges(task)) tabs.push('code');
  tabs.push('chat');
  return tabs;
}

export function resolveTaskTab(param: string | null, tabs: TaskTab[]): TaskTab {
  return tabs.find((tab) => tab === param) ?? 'overview';
}
