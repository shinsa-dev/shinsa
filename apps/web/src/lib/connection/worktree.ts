import { requestWithToast } from '@/lib/connection/commands.ts';
import { requestJson } from '@/lib/connection/http.ts';

type OpenTarget = 'editor' | 'finder' | 'terminal';

const TARGET_NAME: Record<OpenTarget, string> = {
  editor: 'the editor',
  finder: 'Finder',
  terminal: 'a terminal',
};

async function requestOpen(taskId: string, target: OpenTarget, path?: string, line?: number) {
  const opened = await requestJson<{ ok: boolean }>(`/api/tasks/${encodeURIComponent(taskId)}/open`, {
    target,
    path,
    line,
  });
  if (!opened.ok) throw new Error(`Couldn’t open the worktree in ${TARGET_NAME[target]}`);
}

export function openWorktree(taskId: string, target: OpenTarget, path?: string, line?: number) {
  return requestWithToast(() => requestOpen(taskId, target, path, line));
}
