import { hasStep, type Task, type TaskStage } from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import type { CodeMode } from '@/lib/code/location.ts';

export type TaskTab = 'overview' | 'code' | 'chat';

export type ExplorerMode = Exclude<CodeMode, 'search'>;

export const TASK_TAB: Record<TaskTab, { label: string; icon: IconName }> = {
  overview: { label: 'Overview', icon: 'IconHomeRoundDoor' },
  code: { label: 'Code', icon: 'IconCode' },
  chat: { label: 'Chat', icon: 'IconBubbleText' },
};

export const CODE_MODE: Record<CodeMode, { label: string; icon: IconName }> = {
  review: { label: 'Review', icon: 'IconEyeOpen' },
  changes: { label: 'Changes', icon: 'IconDifferenceModified' },
  files: { label: 'Files', icon: 'IconFiles' },
  search: { label: 'Search', icon: 'IconMagnifyingGlass' },
};

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

export function listCodeModes(task: Task): ExplorerMode[] {
  return hasChanges(task) ? ['review', 'changes', 'files'] : ['files'];
}

export function listTaskTabs(task: Task): TaskTab[] {
  return task.repoId || hasChanges(task) ? ['overview', 'code', 'chat'] : ['overview', 'chat'];
}

export function resolveTaskTab(param: string | null, tabs: TaskTab[]): TaskTab {
  return tabs.find((tab) => tab === param) ?? 'overview';
}
