import { hasStep, type Task, type TaskStage } from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';

export type TaskTab = 'overview' | 'code' | 'chat';

export type CodeView = 'review' | 'changes';

export const TASK_TAB: Record<TaskTab, { label: string; icon: IconName }> = {
  overview: { label: 'Overview', icon: 'IconHomeRoundDoor' },
  code: { label: 'Code', icon: 'IconCode' },
  chat: { label: 'Chat', icon: 'IconBubbleText' },
};

export const CODE_VIEW: Record<CodeView, { label: string; icon: IconName }> = {
  review: { label: 'Guided review', icon: 'IconEyeOpen' },
  changes: { label: 'All files', icon: 'IconFiles' },
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

function hasCode(task: Task) {
  if (!hasStep(task, 'build')) return false;
  return task.report !== null || !BEFORE_CODE.has(task.stage);
}

export function listTaskTabs(task: Task): TaskTab[] {
  return hasCode(task) ? ['overview', 'code', 'chat'] : ['overview', 'chat'];
}

export function resolveTaskTab(param: string | null, tabs: TaskTab[]): TaskTab {
  return tabs.find((tab) => tab === param) ?? 'overview';
}

export function resolveCodeView(param: string | null): CodeView {
  return param === 'changes' ? 'changes' : 'review';
}
