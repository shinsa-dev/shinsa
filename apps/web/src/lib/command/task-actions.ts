import { type ShinsaState, TASK_PRIORITIES, type Task, type TaskPriority } from '@shinsa/core';
import { compose } from '@/lib/command/gates.ts';
import { type Command, RANK } from '@/lib/command/registry.ts';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { connection, selectEngineCommands } from '@/lib/connection/socket.ts';
import { PRIORITY_ICON, PRIORITY_LABEL } from '@/lib/format/labels.ts';
import {
  listTaskActions,
  runTaskAction,
  TASK_ACTION,
  type TaskActionKey,
  updatePriority,
} from '@/lib/tasks/actions.ts';
import { resolveMessageHint } from '@/lib/tasks/messages.ts';

const ACTION_KEYWORDS: Record<Exclude<TaskActionKey, 'open'>, string[]> = {
  pullRequest: ['pr', 'github', 'browser'],
  branch: ['git', 'clipboard', 'checkout'],
  editor: ['worktree', 'vscode', 'cursor', 'zed'],
  terminal: ['worktree', 'shell', 'command line'],
  finder: ['worktree', 'files', 'folder', 'reveal'],
  fork: ['handoff', 'copy', 'follow-up', 'new task'],
  share: ['link', 'public', 'teammate', 'publish'],
  unshare: ['link', 'private', 'revoke', 'unshare'],
  moveToBacklog: ['later', 'park', 'schedule', 'not now'],
  removeFromBacklog: ['backlog', 'remove', 'plan to approve', 'needs you'],
  snooze: ['hide', 'later', 'not now', 'put aside', 'pause'],
  unsnooze: ['wake', 'resume', 'pick up', 'show', 'needs you'],
  restart: ['retry', 'rerun', 'again'],
  complete: ['complete', 'finish', 'close', 'resolve'],
  duplicate: ['duplicate', 'same', 'repeat', 'already', 'close'],
  notDuplicate: ['duplicate', 'start', 'reopen', 'restore'],
  cancel: ['stop', 'abandon', 'drop', 'close'],
};

function createPriorityCommand(task: Task): Command {
  return {
    kind: 'choice',
    id: `task.${task.id}.priority`,
    label: 'Set priority',
    hint: PRIORITY_LABEL[task.priority],
    icon: { name: PRIORITY_ICON[task.priority].name },
    keywords: ['priority', 'urgent', 'high', 'normal', 'low', 'importance'],
    heading: 'Priority',
    value: task.priority,
    options: TASK_PRIORITIES.map((priority) => ({
      value: priority,
      label: PRIORITY_LABEL[priority],
      icon: PRIORITY_ICON[priority],
      keywords: ['priority'],
    })),
    pick: (priority) => void updatePriority(task, priority as TaskPriority),
  };
}

function listMessageCommands(state: ShinsaState, task: Task): Command[] {
  const hint = resolveMessageHint(state, task);
  if (!hint) return [];
  return [
    {
      kind: 'page',
      id: `task.${task.id}.message`,
      label: 'Message the agent',
      icon: 'IconBubbleText',
      keywords: ['tell', 'chat', 'say', 'send', 'reply', 'instruct', 'notes'],
      page: compose('Message the agent', hint.placeholder, 'Send', (text) =>
        sendCommandWithToast({ type: 'task.message', taskId: task.id, text }, hint.sent)
      ),
    },
  ];
}

function createCancelCommand(
  task: Task,
  base: { id: string; label: string; icon: Command['icon'] }
): Command {
  return {
    ...base,
    kind: 'page',
    destructive: true,
    keywords: ACTION_KEYWORDS.cancel,
    page: {
      kind: 'list',
      crumb: TASK_ACTION.cancel.label,
      placeholder: 'Cancel this task?',
      sections: [
        {
          id: 'confirm',
          heading: 'Agents stop and the task closes. This cannot be undone.',
          rank: RANK.context,
          commands: [
            {
              kind: 'run',
              id: `${base.id}.confirm`,
              label: 'Cancel the task',
              icon: 'IconCircleX',
              destructive: true,
              run: () => runTaskAction(task, 'cancel'),
            },
            { kind: 'run', id: `${base.id}.keep`, label: 'Keep it', icon: 'IconArrowLeft', run: () => {} },
          ],
        },
      ],
    },
  };
}

function createActionCommand(task: Task, key: Exclude<TaskActionKey, 'open'>): Command {
  const base = { id: `task.${task.id}.${key === 'pullRequest' ? 'pull-request' : key}`, ...TASK_ACTION[key] };
  if (key === 'cancel') return createCancelCommand(task, base);
  if (key === 'pullRequest' && task.pullRequest) {
    return {
      ...base,
      kind: 'link',
      hint: `#${task.pullRequest.number}`,
      keywords: ACTION_KEYWORDS.pullRequest,
      href: task.pullRequest.url,
    };
  }
  return {
    ...base,
    kind: 'run',
    ...(key === 'branch' && task.branch ? { hint: task.branch } : {}),
    keywords: ACTION_KEYWORDS[key],
    run: () => runTaskAction(task, key),
  };
}

export function listTaskActionCommands(state: ShinsaState, task: Task): Command[] {
  const actions = listTaskActions(task, selectEngineCommands(connection.selectEngine(task.id)))
    .flat()
    .flatMap((key) => (key === 'open' ? [] : [createActionCommand(task, key)]));
  return [createPriorityCommand(task), ...listMessageCommands(state, task), ...actions];
}
