import { isDecisionGate, listOpenGates, type ShinsaState, selectLeadGate } from '@shinsa/core';
import type { NowTarget } from '@/lib/overview/now.ts';
import {
  type CodeView,
  listTaskTabs,
  resolveCodeView,
  resolveTaskTab,
  type TaskTab,
} from '@/lib/tasks/tabs.ts';
import { updateSearchParams, useSearchParam } from '@/router.ts';

export type TaskView = ReturnType<typeof useTaskView>;

function applyTab(tab: TaskTab) {
  updateSearchParams({ tab: tab === 'overview' ? null : tab, run: null, view: null, file: null });
}

function applyCodeView(view: CodeView) {
  updateSearchParams({ tab: 'code', view: view === 'review' ? null : view, run: null, file: null });
}

function applyNowTarget(target: NowTarget, runId?: string) {
  if (target === 'agent') {
    updateSearchParams({ tab: 'chat', view: null, file: null, run: runId ?? null });
    return;
  }
  applyCodeView(target);
}

export function useTaskView(state: ShinsaState, taskId: string) {
  const tabParam = useSearchParam('tab');
  const viewParam = useSearchParam('view');
  const chatRunId = useSearchParam('run');
  const task = state.tasks[taskId] ?? null;
  const decision = task ? listOpenGates(state, task.id).find(isDecisionGate) : undefined;
  const lead = (task && selectLeadGate(state, task)) ?? undefined;
  const tabs = task ? listTaskTabs(task) : [];
  return {
    task,
    lead,
    tabs,
    tab: resolveTaskTab(tabParam, tabs),
    codeView: resolveCodeView(viewParam),
    chatRunId,
    reviewing: decision?.type === 'review' || decision?.type === 'merge',
    draftKey: decision?.id ?? 'none',
    applyTab,
    applyCodeView,
    applyNowTarget,
  };
}
