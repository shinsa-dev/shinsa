import { briefingKey, reconcileBriefing, resolveQueue, type ShinsaState } from '@shinsa/core';
import { type Command, type CommandSection, RANK } from '@/lib/command/registry.ts';
import { resolveTaskStatus } from '@/lib/tasks/status.ts';
import { resolveTaskPath } from '@/router.ts';

const NEEDS_SHOWN = 8;

export function listHomeSections(state: ShinsaState): CommandSection[] {
  const now = Date.now();
  const queue = resolveQueue(state, now);
  const briefing = reconcileBriefing(state.briefings[briefingKey(queue.focusProjectId)], queue, now);
  const lead = briefing.now ? state.tasks[briefing.now.taskId] : undefined;
  const candidates = [...(lead ? [lead] : []), ...queue.ready.map((entry) => entry.task)];
  const tasks = [...new Map(candidates.map((task) => [task.id, task])).values()].slice(0, NEEDS_SHOWN);
  if (tasks.length === 0) return [];
  return [
    {
      id: 'home.needs',
      heading: 'Needs you',
      rank: RANK.context,
      commands: tasks.map((task): Command => {
        const repo = task.repoId ? (state.repos[task.repoId]?.name ?? '') : '';
        const status = resolveTaskStatus(state, task).label;
        return {
          kind: 'go',
          id: `home.task.${task.id}`,
          label: task.title,
          ...(repo ? { hint: repo } : {}),
          trailing: status,
          taskId: task.id,
          keywords: [status, task.branch ?? '', 'needs you', 'decision', 'open'],
          to: resolveTaskPath(task),
        };
      }),
    },
  ];
}
