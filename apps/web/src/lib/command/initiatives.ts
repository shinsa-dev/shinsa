import { listInitiatives, type ShinsaState, type Task } from '@shinsa/core';
import { type Command, type CommandSection, RANK } from '@/lib/command/registry.ts';
import { openInitiativeDialog } from '@/lib/initiatives/draft.ts';
import {
  ADD_TO_INITIATIVE,
  ADOPT_TASK,
  adoptTask,
  changeTaskPhase,
  joinInitiative,
  LEAVE_INITIATIVE,
  leaveInitiative,
  listInitiativeChoices,
  MOVE_TO_INITIATIVE,
  PHASE_LABEL,
  selectTaskInitiative,
} from '@/lib/initiatives/membership.ts';
import { INITIATIVE_ICON, INITIATIVES_TITLE, NO_PHASE, NO_PHASE_VALUE } from '@/lib/initiatives/view.ts';
import { resolveInitiativePath, type Route } from '@/router.ts';

const KEYWORDS = ['initiative', 'group', 'effort', 'epic', 'phases'];

export function listInitiativeSections(
  state: ShinsaState,
  route: Route,
  commands: ReadonlySet<string>
): CommandSection[] {
  if (!commands.has('initiative.write')) return [];
  const go: Command[] = [
    {
      kind: 'go',
      id: 'go.initiatives',
      label: INITIATIVES_TITLE,
      icon: INITIATIVE_ICON,
      current: route.name === 'initiatives',
      keywords: KEYWORDS,
      to: '/initiatives',
    },
    {
      kind: 'run',
      id: 'initiative.new',
      label: 'New initiative…',
      icon: 'IconPlusMedium',
      keywords: KEYWORDS,
      run: () => openInitiativeDialog(),
    },
    ...listInitiatives(state).map((initiative): Command => ({
      kind: 'go',
      id: `initiative.${initiative.id}`,
      label: initiative.name,
      hint: 'Initiative',
      icon: INITIATIVE_ICON,
      searchOnly: true,
      current: route.name === 'initiative' && route.reference === initiative.id,
      keywords: KEYWORDS,
      to: resolveInitiativePath(initiative.id),
    })),
  ];
  return [{ id: 'global.initiatives', heading: INITIATIVES_TITLE, rank: RANK.global + 1, commands: go }];
}

function createJoinCommand(state: ShinsaState, task: Task, id: string): Command | null {
  const choices = listInitiativeChoices(state, task);
  if (choices.length === 0) return null;
  const current = selectTaskInitiative(state, task);
  return {
    kind: 'choice',
    id: `${id}.join`,
    label: current ? MOVE_TO_INITIATIVE : ADD_TO_INITIATIVE,
    icon: INITIATIVE_ICON,
    keywords: KEYWORDS,
    heading: INITIATIVES_TITLE,
    value: null,
    options: choices.map((initiative) => ({ value: initiative.id, label: initiative.name })),
    pick: (value) => {
      const chosen = state.initiatives[value];
      if (chosen) void joinInitiative(task, chosen);
    },
  };
}

function listMemberCommands(state: ShinsaState, task: Task, id: string): Command[] {
  const current = selectTaskInitiative(state, task);
  if (!current) return [];
  const phase: Command[] =
    current.phases.length === 0
      ? []
      : [
          {
            kind: 'choice',
            id: `${id}.phase`,
            label: `Move to another phase of ${current.name}`,
            icon: 'IconLayersThree',
            keywords: [...KEYWORDS, 'phase'],
            heading: PHASE_LABEL,
            value: task.initiativePhaseId ?? NO_PHASE_VALUE,
            options: [
              ...current.phases.map((each) => ({ value: each.id, label: each.name })),
              { value: NO_PHASE_VALUE, label: NO_PHASE },
            ],
            pick: (value) => void changeTaskPhase(task, current, value || null),
          },
        ];
  return [
    ...phase,
    {
      kind: 'go',
      id: `${id}.open`,
      label: `Open the initiative ${current.name}`,
      icon: INITIATIVE_ICON,
      keywords: KEYWORDS,
      to: resolveInitiativePath(current.id),
    },
    {
      kind: 'run',
      id: `${id}.leave`,
      label: LEAVE_INITIATIVE,
      icon: 'IconCrossMedium',
      keywords: KEYWORDS,
      run: () => void leaveInitiative(task, current),
    },
  ];
}

export function listTaskInitiativeCommands(
  state: ShinsaState,
  task: Task,
  commands: ReadonlySet<string>
): Command[] {
  if (!commands.has('task.join_initiative')) return [];
  const id = `task.${task.id}.initiative`;
  const join = createJoinCommand(state, task, id);
  const adopt: Command[] =
    !task.initiativeId && commands.has('initiative.adopt_task')
      ? [
          {
            kind: 'run',
            id: `${id}.adopt`,
            label: ADOPT_TASK,
            icon: INITIATIVE_ICON,
            keywords: KEYWORDS,
            run: () => void adoptTask(task),
          },
        ]
      : [];
  return [...(join ? [join] : []), ...listMemberCommands(state, task, id), ...adopt];
}
