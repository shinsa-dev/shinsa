import type { ShinsaState } from '@shinsa/core';

const TASK_READS = /^\/api\/tasks\/([^/]+)(?:\/(?:blob|chat|diff|paths|raw|refs|search|tree))?$/;

const FILE_READS = /^\/api\/(?:evidence|attachments)\/(.+)$/;

function isReferenced(state: ShinsaState, taskId: string, name: string) {
  const evidence = Object.values(state.evidence).filter((entry) => entry.taskId === taskId);
  return JSON.stringify([state.tasks[taskId], evidence]).includes(name);
}

export function isGuestRoute(state: ShinsaState, taskId: string, method: string, pathname: string) {
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (pathname === '/api/health') return true;
  const task = TASK_READS.exec(pathname);
  if (task) return decodeURIComponent(task[1] ?? '') === taskId;
  const file = FILE_READS.exec(pathname);
  return file !== null && isReferenced(state, taskId, file[1] ?? '');
}
