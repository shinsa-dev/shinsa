import type { ShinsaState } from '@shinsa/core';
import * as React from 'react';
import { prepareCodeDiff } from '@/components/text/code-diff.tsx';
import { useIdle, useIdleValue } from '@/hooks/use-idle.ts';
import { listPrefetchRuns, prefetchTranscript } from '@/lib/chat/prefetch.ts';
import { prefetchSnippets, scheduleIdle } from '@/lib/code/prefetch.ts';
import { refreshExtensions } from '@/lib/connection/extensions.ts';
import { refreshRemoteAccess } from '@/lib/connection/remote-access.ts';
import { connection } from '@/lib/connection/socket.ts';
import { refreshVersions } from '@/lib/connection/versions.ts';
import { prefetchEvidence } from '@/lib/evidence/prefetch.ts';
import { listReviewChapters, listReviewPoints } from '@/lib/review/report.ts';
import { findTaskTarget, listIdleTasks } from '@/lib/tasks/prefetch.ts';
import { hasReview, listTaskTabs } from '@/lib/tasks/tabs.ts';
import { prefetchCode } from './lazy-code.tsx';

const HOVER_INTENT_MS = 40;

function skipFailure() {
  return null;
}

function prefetchTaskCode(state: ShinsaState, taskId: string, search: string) {
  const task = state.tasks[taskId];
  if (!task) return null;
  prefetchEvidence(state, task);
  if (hasReview(task)) {
    const paths = listReviewPoints(
      listReviewChapters(task.report, task.findings, task.reviewDisagreements)
    ).flatMap((item) => (item.place ? [item.place.file] : []));
    void prepareCodeDiff(paths).then(undefined, skipFailure);
    if (task.repoId) prefetchSnippets(task, paths);
  }
  if (listTaskTabs(task).includes('code')) void prefetchCode(task, search);
  return task;
}

export function prefetchTask(state: ShinsaState, taskId: string, search = '') {
  const task = prefetchTaskCode(state, taskId, search);
  if (!task) return;
  for (const runId of listPrefetchRuns(state, task.id)) prefetchTranscript(connection, runId);
}

function useHoverPrefetch(state: ShinsaState) {
  const latest = React.useRef(state);
  latest.current = state;
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: string | null = null;
    const onOver = (event: PointerEvent) => {
      const taskId = findTaskTarget(event.target);
      if (taskId === pending) return;
      if (timer) clearTimeout(timer);
      timer = null;
      pending = taskId;
      if (!taskId) return;
      timer = setTimeout(() => {
        timer = null;
        prefetchTask(latest.current, taskId);
      }, HOVER_INTENT_MS);
    };
    document.addEventListener('pointerover', onOver);
    return () => {
      document.removeEventListener('pointerover', onOver);
      if (timer) clearTimeout(timer);
    };
  }, []);
}

function useIdlePrefetch(state: ShinsaState) {
  const settled = useIdleValue(state);
  const latest = React.useRef(state);
  latest.current = state;
  const key = listIdleTasks(settled, Date.now()).join(' ');
  React.useEffect(
    () =>
      scheduleIdle(() => {
        for (const taskId of key.split(' ')) if (taskId) prefetchTaskCode(latest.current, taskId, '');
      }),
    [key]
  );
}

export function usePrefetchTaskPage(state: ShinsaState, taskId: string | null) {
  const latest = React.useRef(state);
  latest.current = state;
  React.useEffect(() => {
    if (!taskId) return;
    return scheduleIdle(() => prefetchTask(latest.current, taskId, window.location.search));
  }, [taskId]);
}

function useSettingsPrefetch() {
  const idle = useIdle();
  React.useEffect(() => {
    if (!idle) return;
    void refreshVersions();
    void refreshExtensions();
    void refreshRemoteAccess();
  }, [idle]);
}

export function Prefetch({ state }: { state: ShinsaState }) {
  useHoverPrefetch(state);
  useIdlePrefetch(state);
  useSettingsPrefetch();
  return null;
}
