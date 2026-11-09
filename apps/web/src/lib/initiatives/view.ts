import {
  NO_PHASE_NAME,
  type Activity,
  type InitiativeDecision,
  type InitiativePhaseGroup,
  type InitiativeSheet,
  type ShinsaState,
} from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import {
  type ChainEntry,
  listTaskGroupSections,
  orderChains,
  resolveTaskGroup,
  type TaskGroup,
  type TaskGroupRow,
} from '@/lib/tasks/groups.ts';

export const INITIATIVE_ICON: IconName = 'IconTarget';

export const INITIATIVES_TITLE = 'Initiatives';

export const NO_PHASE_VALUE = '';

const WAITING = 'Waiting';

const NEXT_ICON: IconName = 'IconHourglass';

export interface InitiativeTaskSection {
  key: string;
  group: Pick<TaskGroup, 'title' | 'icon' | 'tone' | 'defaultOpen'>;
  entries: ChainEntry[];
}

function describeDecision(state: ShinsaState, decision: InitiativeDecision): Activity {
  const task = state.tasks[decision.taskId];
  const name = task?.handle ?? `“${decision.title}”`;
  const plan = decision.kind === 'plan';
  return {
    at: decision.at,
    actor: plan ? 'you' : 'agent',
    kind: plan ? 'decision' : 'shape',
    text: plan ? `Approved the plan of ${name}` : `${name} chose: ${decision.title}`,
    detail: decision.text,
    evidenceId: null,
  };
}

export function listInitiativeActivity(state: ShinsaState, sheet: InitiativeSheet): Activity[] {
  return sheet.decisions.map((decision) => describeDecision(state, decision));
}

function resolveNextTitle(group: InitiativePhaseGroup, phased: boolean) {
  if (!phased) return WAITING;
  return group.phase?.name ?? NO_PHASE_NAME;
}

export function listInitiativeTaskSections(
  state: ShinsaState,
  sheet: InitiativeSheet
): InitiativeTaskSection[] {
  const rows: TaskGroupRow[] = [
    ...sheet.needsYou.map(({ task }) => ({ task, group: resolveTaskGroup(state, task) })),
    ...sheet.now.map((task) => ({ task, group: 'working' as const })),
    ...sheet.shipped.map((task) => ({ task, group: 'done' as const })),
    ...sheet.dropped.map(({ task }) => ({ task, group: 'cancelled' as const })),
  ];
  const grouped = listTaskGroupSections(state, rows).map(({ group, entries }) => ({
    key: group.key,
    group,
    entries,
  }));
  const phased = sheet.next.some((group) => group.phase !== null);
  const next = sheet.next.map((group) => ({
    key: `next:${group.phase?.id ?? 'none'}`,
    group: {
      title: resolveNextTitle(group, phased),
      icon: NEXT_ICON,
      tone: 'neutral' as const,
      defaultOpen: true,
    },
    entries: orderChains(
      state,
      group.tasks.map(({ task }) => task)
    ),
  }));
  const working = grouped.findIndex((section) => section.key === 'working');
  return [...grouped.slice(0, working + 1), ...next, ...grouped.slice(working + 1)].filter(
    (section) => section.entries.length > 0
  );
}
