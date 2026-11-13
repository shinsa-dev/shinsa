import {
  type Activity,
  type InitiativeDecision,
  type InitiativePhase,
  type InitiativeSheet,
  type InitiativeTeamMember,
  type InitiativeTeammateSection,
  isTaskSettled,
  NO_PHASE_NAME,
  RUN_STAGES,
  type ShinsaState,
  type Task,
  type TeamFeedInitiative,
} from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import {
  type ChainEntry,
  listTaskGroupSections,
  orderChains,
  resolveTaskGroup,
  type TaskGroup,
  type TaskGroupKey,
  type TaskGroupRow,
  type TeamEntry,
} from '@/lib/tasks/groups.ts';
import { isOwnTeamInitiativeTask, isTeamInitiativeEntry } from './team.ts';

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

function resolveNextTitle(phase: InitiativePhase | null, phased: boolean) {
  if (!phased) return WAITING;
  return phase?.name ?? NO_PHASE_NAME;
}

interface SheetRow {
  task: Task;
  team?: TeamEntry;
  group: TaskGroupKey | null;
  phaseId: string | null;
}

function toTeamChain(team: TeamEntry): ChainEntry {
  return { task: team.entry.task, depth: 0, team };
}

function resolveSectionGroup(team: TeamEntry, section: InitiativeTeammateSection): TaskGroupKey | null {
  if (section === 'next') return null;
  if (section === 'dropped') return 'cancelled';
  if (section === 'shipped') return 'done';
  if (section === 'now') return 'working';
  return resolveTaskGroup(team.state, team.entry.task);
}

function listNextSections(
  state: ShinsaState,
  phases: readonly InitiativePhase[],
  rows: readonly SheetRow[]
): InitiativeTaskSection[] {
  const next = rows.filter((row) => row.group === null);
  const phased = next.some((row) => row.phaseId !== null);
  return [...phases, null].flatMap((phase) => {
    const members = next.filter((row) => row.phaseId === (phase?.id ?? null));
    if (members.length === 0) return [];
    const own = members.filter((row) => !row.team).map((row) => row.task);
    const team = members.flatMap((row) => (row.team ? [toTeamChain(row.team)] : []));
    return [
      {
        key: `next:${phase?.id ?? 'none'}`,
        group: {
          title: resolveNextTitle(phase, phased),
          icon: NEXT_ICON,
          tone: 'neutral' as const,
          defaultOpen: true,
        },
        entries: [...orderChains(state, own), ...team],
      },
    ];
  });
}

function listSheetSections(
  state: ShinsaState,
  phases: readonly InitiativePhase[],
  rows: readonly SheetRow[]
): InitiativeTaskSection[] {
  const grouped = listTaskGroupSections(
    state,
    rows.flatMap((row): TaskGroupRow[] =>
      row.group === null
        ? []
        : [{ task: row.task, group: row.group, ...(row.team ? { team: row.team } : {}) }]
    )
  ).map(({ group, entries }) => ({ key: group.key, group, entries }));
  const next = listNextSections(state, phases, rows);
  const working = grouped.findIndex((section) => section.key === 'working');
  return [...grouped.slice(0, working + 1), ...next, ...grouped.slice(working + 1)].filter(
    (section) => section.entries.length > 0
  );
}

function selectTeammateEntry(team: readonly TeamEntry[], member: InitiativeTeamMember) {
  return (
    team.find(
      ({ entry }) =>
        entry.teamId === member.teamId &&
        entry.instanceId === member.instanceId &&
        entry.task.id === member.taskId
    ) ?? null
  );
}

export function listInitiativeTaskSections(
  state: ShinsaState,
  sheet: InitiativeSheet,
  team: readonly TeamEntry[] = []
): InitiativeTaskSection[] {
  const rows: SheetRow[] = [
    ...sheet.needsYou.map(({ task }) => ({ task, group: resolveTaskGroup(state, task), phaseId: null })),
    ...sheet.now.map((task) => ({ task, group: 'working' as const, phaseId: null })),
    ...sheet.next.flatMap((group) =>
      group.tasks.map(({ task }) => ({ task, group: null, phaseId: group.phase?.id ?? null }))
    ),
    ...sheet.shipped.map((task) => ({ task, group: 'done' as const, phaseId: null })),
    ...sheet.dropped.map(({ task }) => ({ task, group: 'cancelled' as const, phaseId: null })),
    ...sheet.teammates.flatMap(({ member, phase, section }) => {
      const entry = selectTeammateEntry(team, member);
      if (!entry) return [];
      return [
        {
          task: entry.entry.task,
          team: entry,
          group: resolveSectionGroup(entry, section),
          phaseId: phase?.id ?? null,
        },
      ];
    }),
  ];
  return listSheetSections(state, sheet.initiative.phases, rows);
}

function resolveEntrySection(team: TeamEntry): InitiativeTeammateSection {
  const { task } = team.entry;
  if (task.stage === 'cancelled') return 'dropped';
  if (isTaskSettled(task)) return 'shipped';
  if (RUN_STAGES.has(task.stage)) return 'now';
  const group = resolveTaskGroup(team.state, task);
  return group === 'working' || group === 'snoozed' || group === 'backlog' ? 'next' : 'owner';
}

function resolveOwnSection(state: ShinsaState, task: Task): TaskGroupKey | null {
  if (task.stage === 'cancelled') return 'cancelled';
  if (isTaskSettled(task)) return 'done';
  if (RUN_STAGES.has(task.stage)) return 'working';
  const group = resolveTaskGroup(state, task);
  return group === 'working' || group === 'snoozed' || group === 'backlog' ? null : group;
}

function resolveKnownPhase(initiative: TeamFeedInitiative, phaseId: string | null | undefined) {
  return initiative.phases.some((phase) => phase.id === phaseId) ? (phaseId ?? null) : null;
}

export function listTeamInitiativeTaskSections(
  state: ShinsaState,
  initiative: TeamFeedInitiative,
  team: readonly TeamEntry[]
): InitiativeTaskSection[] {
  const rows: SheetRow[] = [
    ...Object.values(state.tasks)
      .filter((task) => isOwnTeamInitiativeTask(task, initiative))
      .map((task) => ({
        task,
        group: resolveOwnSection(state, task),
        phaseId: resolveKnownPhase(initiative, task.teamInitiative?.phaseId),
      })),
    ...team
      .filter(({ entry }) => isTeamInitiativeEntry(entry, initiative))
      .map((entry) => ({
        task: entry.entry.task,
        team: entry,
        group: resolveSectionGroup(entry, resolveEntrySection(entry)),
        phaseId: resolveKnownPhase(initiative, entry.entry.initiative?.phaseId),
      })),
  ];
  return listSheetSections(state, initiative.phases, rows);
}

export function hasTeamRows(sections: readonly InitiativeTaskSection[]) {
  return sections.some((section) => section.entries.some((entry) => entry.team));
}
