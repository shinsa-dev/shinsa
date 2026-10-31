import { isTaskSettled, resolveBacklogRefusal, type Task, type TaskPriority } from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import { copyText, sendCommandWithToast } from '@/lib/connection/commands.ts';
import { openTaskTerminal } from '@/lib/connection/terminals.ts';
import { openWorktree } from '@/lib/connection/worktree.ts';
import { PRIORITY_LABEL } from '@/lib/format/labels.ts';
import { openShareDialog, openUnshareConfirm, SHARE_TITLE, UNSHARE_TITLE } from '@/lib/share/dialog.ts';
import { FORK_TITLE, openForkDialog } from '@/lib/tasks/fork.ts';
import { navigate, resolveTaskPath } from '@/router.ts';

export type TaskActionKey =
  | 'open'
  | 'pullRequest'
  | 'branch'
  | 'editor'
  | 'terminal'
  | 'finder'
  | 'fork'
  | 'share'
  | 'unshare'
  | 'moveToBacklog'
  | 'removeFromBacklog'
  | 'restart'
  | 'complete'
  | 'cancel';

export const TASK_ACTION: Record<TaskActionKey, { label: string; icon: IconName }> = {
  open: { label: 'Open task', icon: 'IconArrowUpRight' },
  pullRequest: { label: 'Open the pull request on GitHub', icon: 'IconGithub' },
  branch: { label: 'Copy branch name', icon: 'IconBranch' },
  editor: { label: 'Open in editor', icon: 'IconCodeLines' },
  terminal: { label: 'Open a terminal', icon: 'IconConsole' },
  finder: { label: 'Show in Finder', icon: 'IconFolder1' },
  fork: { label: FORK_TITLE, icon: 'IconFork' },
  share: { label: SHARE_TITLE, icon: 'IconShareOs' },
  unshare: { label: UNSHARE_TITLE, icon: 'IconEyeSlash' },
  moveToBacklog: { label: 'Move to the backlog', icon: 'IconArchive' },
  removeFromBacklog: { label: 'Remove from the backlog', icon: 'IconInboxEmpty' },
  restart: { label: 'Restart the current step', icon: 'IconArrowsRepeat' },
  complete: { label: 'Mark as done', icon: 'IconCheckCircle2' },
  cancel: { label: 'Cancel task', icon: 'IconCircleX' },
};

export function listTaskActions(task: Task): TaskActionKey[][] {
  const links: TaskActionKey[] = [];
  if (task.pullRequest) links.push('pullRequest');
  if (task.branch) links.push('branch');
  const worktree: TaskActionKey[] = task.worktreePath ? ['editor', 'terminal', 'finder'] : [];
  const lifecycle: TaskActionKey[] = isTaskSettled(task) ? [] : ['restart', 'complete', 'cancel'];
  const fork: TaskActionKey[] = task.stage === 'cancelled' ? [] : ['fork'];
  const share: TaskActionKey[] = task.watchHome ? [] : ['share'];
  if (task.share) share.push('unshare');
  return [links, worktree, [...fork, ...share], listBacklogActions(task), lifecycle].filter(
    (group) => group.length > 0
  );
}

function listBacklogActions(task: Task): TaskActionKey[] {
  if (task.backlog) return ['removeFromBacklog'];
  return resolveBacklogRefusal(task) === null ? ['moveToBacklog'] : [];
}

export function runTaskAction(task: Task, key: TaskActionKey) {
  switch (key) {
    case 'open':
      navigate(resolveTaskPath(task));
      return;
    case 'pullRequest':
      if (task.pullRequest) window.open(task.pullRequest.url, '_blank', 'noopener');
      return;
    case 'branch':
      if (task.branch) void copyText(task.branch);
      return;
    case 'terminal':
      void openTaskTerminal(task);
      return;
    case 'editor':
    case 'finder':
      void openWorktree(task.id, key);
      return;
    case 'fork':
      openForkDialog(task.id);
      return;
    case 'share':
      openShareDialog(task.id);
      return;
    case 'unshare':
      openUnshareConfirm(task.id);
      return;
    case 'moveToBacklog':
      void sendCommandWithToast({ type: 'task.move_to_backlog', taskId: task.id }, 'Moved to the backlog.');
      return;
    case 'removeFromBacklog':
      void sendCommandWithToast(
        { type: 'task.remove_from_backlog', taskId: task.id },
        'Removed from the backlog. Its plan now waits for your approval.'
      );
      return;
    case 'restart':
      void sendCommandWithToast({ type: 'task.retry', taskId: task.id }, 'Restarted.');
      return;
    case 'complete':
      void sendCommandWithToast({ type: 'task.complete', taskId: task.id }, 'Marked done.');
      return;
    case 'cancel':
      void sendCommandWithToast({ type: 'task.cancel', taskId: task.id }, 'Cancelled.');
      return;
  }
}

export function updatePriority(task: Task, priority: TaskPriority) {
  return sendCommandWithToast(
    { type: 'task.prioritize', taskId: task.id, priority },
    `Priority set to ${PRIORITY_LABEL[priority].toLowerCase()}.`
  );
}
