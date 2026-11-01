import {
  type EngineCommand,
  isTaskSettled,
  resolveBacklogRefusal,
  type Task,
  type TaskPriority,
} from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import { copyText, sendCommandWithToast } from '@/lib/connection/commands.ts';
import { openTaskTerminal } from '@/lib/connection/terminals.ts';
import { openWorktree } from '@/lib/connection/worktree.ts';
import { PRIORITY_LABEL } from '@/lib/format/labels.ts';
import {
  openShareDialog,
  openUnshareConfirm,
  SHARE_TITLE,
  selectLiveShare,
  UNSHARE_TITLE,
} from '@/lib/share/dialog.ts';
import { DUPLICATE_TITLE, openDuplicateDialog, startNotDuplicate } from '@/lib/tasks/duplicate.ts';
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
  | 'snooze'
  | 'unsnooze'
  | 'restart'
  | 'complete'
  | 'duplicate'
  | 'notDuplicate'
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
  snooze: { label: 'Snooze', icon: 'IconClockSnooze' },
  unsnooze: { label: 'Unsnooze', icon: 'IconBell' },
  restart: { label: 'Restart the current step', icon: 'IconArrowsRepeat' },
  complete: { label: 'Mark as done', icon: 'IconCheckCircle2' },
  duplicate: { label: DUPLICATE_TITLE, icon: 'IconSquareBehindSquare2' },
  notDuplicate: { label: 'Not a duplicate, start it', icon: 'IconPlayCircle' },
  cancel: { label: 'Cancel task', icon: 'IconCircleX' },
};

export const TASK_ACTION_COMMAND: Record<TaskActionKey, EngineCommand | null> = {
  open: null,
  pullRequest: null,
  branch: null,
  editor: null,
  terminal: null,
  finder: null,
  fork: 'task.create',
  share: 'task.share',
  unshare: 'task.unshare',
  moveToBacklog: 'task.move_to_backlog',
  removeFromBacklog: 'task.remove_from_backlog',
  snooze: 'task.snooze',
  unsnooze: 'task.unsnooze',
  restart: 'task.retry',
  complete: 'task.complete',
  duplicate: 'task.mark_duplicate',
  notDuplicate: 'task.clear_duplicate',
  cancel: 'task.cancel',
};

function isActionSpoken(key: TaskActionKey, commands: ReadonlySet<string>) {
  const command = TASK_ACTION_COMMAND[key];
  return command === null || commands.has(command);
}

export function listTaskActions(
  task: Task,
  commands: ReadonlySet<string>,
  now = Date.now()
): TaskActionKey[][] {
  const links: TaskActionKey[] = [];
  if (task.pullRequest) links.push('pullRequest');
  if (task.branch) links.push('branch');
  const worktree: TaskActionKey[] = task.worktreePath ? ['editor', 'terminal', 'finder'] : [];
  const lifecycle: TaskActionKey[] = isTaskSettled(task)
    ? listSettledActions(task)
    : ['restart', 'complete', 'duplicate', 'cancel'];
  const fork: TaskActionKey[] = task.stage === 'cancelled' ? [] : ['fork'];
  const share = listShareActions(task, now);
  return [links, worktree, [...fork, ...share], listLaterActions(task), lifecycle]
    .map((group) => group.filter((key) => isActionSpoken(key, commands)))
    .filter((group) => group.length > 0);
}

function listShareActions(task: Task, now: number): TaskActionKey[] {
  const live = selectLiveShare(task, now);
  const share: TaskActionKey[] = task.watchHome ? [] : ['share'];
  return live ? ['unshare'] : share;
}

function listSettledActions(task: Task): TaskActionKey[] {
  return task.duplicate ? ['notDuplicate'] : [];
}

function listLaterActions(task: Task): TaskActionKey[] {
  if (isTaskSettled(task)) return [];
  const snooze: TaskActionKey = task.snoozed ? 'unsnooze' : 'snooze';
  if (task.backlog) return ['removeFromBacklog', snooze];
  return resolveBacklogRefusal(task) === null ? ['moveToBacklog', snooze] : [snooze];
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
        'Removed from the backlog.'
      );
      return;
    case 'snooze':
      void sendCommandWithToast({ type: 'task.snooze', taskId: task.id }, 'Snoozed.');
      return;
    case 'unsnooze':
      void sendCommandWithToast({ type: 'task.unsnooze', taskId: task.id }, 'Unsnoozed.');
      return;
    case 'restart':
      void sendCommandWithToast({ type: 'task.retry', taskId: task.id }, 'Restarted.');
      return;
    case 'complete':
      void sendCommandWithToast({ type: 'task.complete', taskId: task.id }, 'Marked done.');
      return;
    case 'duplicate':
      openDuplicateDialog(task.id);
      return;
    case 'notDuplicate':
      void startNotDuplicate(task);
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
