import { isDecisionGate, listOpenGates, type ShinsaState, selectLeadGate } from '@shinsa/core';
import { type CodeMode, resolveClearPatch, resolveModePatch } from '@/lib/code/location.ts';
import type { NowTarget } from '@/lib/overview/now.ts';
import { listCodeModes, listTaskTabs, resolveTaskTab, type TaskTab } from '@/lib/tasks/tabs.ts';
import { updateSearchParams, useSearchParam } from '@/router.ts';

export type TaskView = ReturnType<typeof useTaskView>;

function applyTab(tab: TaskTab) {
  updateSearchParams({ ...resolveClearPatch(), tab: tab === 'overview' ? null : tab, run: null });
}

export function applyNowTarget(target: NowTarget, runId?: string) {
  if (target === 'agent') {
    updateSearchParams({ ...resolveClearPatch(), tab: 'chat', run: runId ?? null });
    return;
  }
  if (target === 'review') {
    updateSearchParams({ ...resolveClearPatch(), tab: 'review', run: null });
    return;
  }
  updateSearchParams({ ...resolveClearPatch(), tab: 'code', run: null, mode: target });
}

export function useTaskView(state: ShinsaState, taskId: string) {
  const tabParam = useSearchParam('tab');
  const chatRunId = useSearchParam('run');
  const task = state.tasks[taskId] ?? null;
  const decision = task ? listOpenGates(state, task.id).find(isDecisionGate) : undefined;
  const lead = (task && selectLeadGate(state, task)) ?? undefined;
  const tabs = task ? listTaskTabs(task) : [];
  const codeModes = task ? listCodeModes(task) : [];
  return {
    task,
    lead,
    tabs,
    tab: resolveTaskTab(tabParam, tabs),
    codeModes,
    chatRunId,
    reviewing: decision?.type === 'review' || decision?.type === 'merge',
    draftKey: decision?.id ?? 'none',
    applyTab,
    applyCodeMode: (mode: CodeMode) =>
      updateSearchParams({ tab: 'code', run: null, ...resolveModePatch(mode, codeModes) }),
    applyNowTarget,
  };
}
