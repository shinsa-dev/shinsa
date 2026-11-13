import {
  NO_PHASE_NAME,
  NO_TEAM_FEED,
  type ShinsaState,
  type Task,
  type TeamFeedInitiative,
  type TeamFeedSnapshot,
} from '@shinsa/core';
import { type Command, type CommandSection, RANK } from '@/lib/command/registry.ts';
import type { FocusTeam } from '@/lib/focus.ts';
import { openInitiativeDialog } from '@/lib/initiatives/draft.ts';
import { selectLedInitiative } from '@/lib/initiatives/lead.ts';
import {
  ADD_TO_INITIATIVE,
  ADOPT_TASK,
  adoptTask,
  changeTaskPhase,
  joinInitiative,
  LEAVE_INITIATIVE,
  leaveInitiative,
  listInitiativeChoices,
  listOpenInitiatives,
  MOVE_TO_INITIATIVE,
  PHASE_LABEL,
  selectTaskInitiative,
} from '@/lib/initiatives/membership.ts';
import {
  changeTeamPhase,
  joinTeamInitiative,
  leaveTeamInitiative,
  listTeamInitiativeChoices,
  listTeamShareChoices,
  resolveTeamLeadPath,
  selectTaskTeamInitiative,
  shareInitiative,
  TEAMMATE_INITIATIVE,
} from '@/lib/initiatives/team.ts';
import { INITIATIVE_ICON, INITIATIVES_TITLE, NO_PHASE_VALUE } from '@/lib/initiatives/view.ts';
import { resolveTaskPath, type Route } from '@/router.ts';

const KEYWORDS = ['initiative', 'group', 'effort', 'epic', 'phases'];

const TEAM_KEYWORDS = [...KEYWORDS, 'team', 'teammate', 'share'];

const TEAM_VALUE = 'team:';

export interface InitiativeTeams {
  feed: TeamFeedSnapshot;
  teams: readonly FocusTeam[];
}

const NO_INITIATIVE_TEAMS: InitiativeTeams = { feed: NO_TEAM_FEED, teams: [] };

function resolveTeamValue(initiative: TeamFeedInitiative) {
  return `${TEAM_VALUE}${initiative.teamId}:${initiative.instanceId}:${initiative.id}`;
}

function listTeamGoCommands(route: Route, teams: InitiativeTeams): Command[] {
  const teamIds = new Set(teams.teams.map((team) => team.id));
  const seen = new Set<string>();
  return (teams.feed.initiatives ?? []).flatMap((initiative): Command[] => {
    const key = `${initiative.instanceId}:${initiative.id}`;
    if (initiative.finished || !teamIds.has(initiative.teamId) || seen.has(key)) return [];
    seen.add(key);
    const to = resolveTeamLeadPath(initiative);
    return [
      {
        kind: 'go',
        id: `initiative.team.${key}`,
        label: initiative.name,
        hint: TEAMMATE_INITIATIVE,
        icon: INITIATIVE_ICON,
        searchOnly: true,
        current: route.name === 'team-task' && route.taskId === initiative.leadTaskId,
        keywords: TEAM_KEYWORDS,
        to,
      },
    ];
  });
}

export function listInitiativeSections(
  state: ShinsaState,
  route: Route,
  teams: InitiativeTeams = NO_INITIATIVE_TEAMS
): CommandSection[] {
  const own = listOpenInitiatives(state).flatMap((initiative): Command[] => {
    const lead = initiative.leadTaskId ? state.tasks[initiative.leadTaskId] : undefined;
    if (!lead) return [];
    return [
      {
        kind: 'go',
        id: `initiative.${initiative.id}`,
        label: initiative.name,
        hint: 'Initiative',
        icon: INITIATIVE_ICON,
        searchOnly: true,
        current: route.name === 'task' && route.reference === (lead.handle ?? lead.id),
        keywords: KEYWORDS,
        to: resolveTaskPath(lead),
      },
    ];
  });
  const go = [...own, ...listTeamGoCommands(route, teams)];
  if (go.length === 0) return [];
  return [{ id: 'global.initiatives', heading: INITIATIVES_TITLE, rank: RANK.global + 1, commands: go }];
}

function createJoinCommand(
  state: ShinsaState,
  task: Task,
  id: string,
  teams: InitiativeTeams
): Command | null {
  const choices = listInitiativeChoices(state, task);
  const teamChoices = listTeamInitiativeChoices(teams.feed, teams.teams, task);
  if (choices.length + teamChoices.length === 0) return null;
  const current = selectTaskInitiative(state, task) ?? task.teamInitiative;
  return {
    kind: 'choice',
    id: `${id}.join`,
    label: current ? MOVE_TO_INITIATIVE : ADD_TO_INITIATIVE,
    icon: INITIATIVE_ICON,
    keywords: KEYWORDS,
    heading: INITIATIVES_TITLE,
    value: null,
    options: [
      ...choices.map((initiative) => ({ value: initiative.id, label: initiative.name })),
      ...teamChoices.map((initiative) => ({
        value: resolveTeamValue(initiative),
        label: initiative.name,
        hint: TEAMMATE_INITIATIVE,
      })),
    ],
    pick: (value) => {
      const team = teamChoices.find((initiative) => resolveTeamValue(initiative) === value);
      if (team) {
        void joinTeamInitiative(task, team);
        return;
      }
      const chosen = state.initiatives[value];
      if (chosen) void joinInitiative(task, chosen);
    },
  };
}

function listMemberCommands(state: ShinsaState, task: Task, id: string): Command[] {
  const current = selectTaskInitiative(state, task);
  const lead = current?.leadTaskId ? state.tasks[current.leadTaskId] : undefined;
  if (!current || !lead) return [];
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
              { value: NO_PHASE_VALUE, label: NO_PHASE_NAME },
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
      to: resolveTaskPath(lead),
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

function listTeamMemberCommands(task: Task, id: string, teams: InitiativeTeams): Command[] {
  if (!task.teamInitiative) return [];
  const current = selectTaskTeamInitiative(teams.feed, task);
  const leave: Command = {
    kind: 'run',
    id: `${id}.leave`,
    label: LEAVE_INITIATIVE,
    icon: 'IconCrossMedium',
    keywords: TEAM_KEYWORDS,
    run: () => void leaveTeamInitiative(task),
  };
  if (!current) return [leave];
  const phase: Command[] =
    current.phases.length === 0
      ? []
      : [
          {
            kind: 'choice',
            id: `${id}.phase`,
            label: `Move to another phase of ${current.name}`,
            icon: 'IconLayersThree',
            keywords: [...TEAM_KEYWORDS, 'phase'],
            heading: PHASE_LABEL,
            value: task.teamInitiative.phaseId ?? NO_PHASE_VALUE,
            options: [
              ...current.phases.map((each) => ({ value: each.id, label: each.name })),
              { value: NO_PHASE_VALUE, label: NO_PHASE_NAME },
            ],
            pick: (value) => void changeTeamPhase(task, current, value || null),
          },
        ];
  return [
    ...phase,
    {
      kind: 'go',
      id: `${id}.open`,
      label: `Open the initiative ${current.name}`,
      icon: INITIATIVE_ICON,
      keywords: TEAM_KEYWORDS,
      to: resolveTeamLeadPath(current),
    },
    leave,
  ];
}

function listShareCommands(
  state: ShinsaState,
  task: Task,
  id: string,
  commands: ReadonlySet<string>,
  teams: InitiativeTeams
): Command[] {
  const led = selectLedInitiative(state, task);
  if (!led || !commands.has('initiative.add_to_team')) return [];
  return listTeamShareChoices(led, teams.teams).map(({ team, shared }) => ({
    kind: 'run',
    id: `${id}.team.${team.id}`,
    label: shared
      ? `Stop sharing the initiative with ${team.name}`
      : `Share the initiative with ${team.name}`,
    icon: INITIATIVE_ICON,
    keywords: TEAM_KEYWORDS,
    run: () => void shareInitiative(led, team, !shared),
  }));
}

function listLeadCommands(state: ShinsaState, task: Task, id: string, commands: ReadonlySet<string>) {
  const led = selectLedInitiative(state, task);
  if (!led || !commands.has('initiative.write')) return [];
  return [
    {
      kind: 'run',
      id: `${id}.edit`,
      label: 'Edit the initiative',
      icon: 'IconPencil',
      keywords: [...KEYWORDS, 'rename', 'phase'],
      run: () => openInitiativeDialog(led.id),
    } satisfies Command,
  ];
}

export function listTaskInitiativeCommands(
  state: ShinsaState,
  task: Task,
  commands: ReadonlySet<string>,
  teams: InitiativeTeams = NO_INITIATIVE_TEAMS
): Command[] {
  if (!commands.has('task.join_initiative')) return [];
  const id = `task.${task.id}.initiative`;
  if (selectLedInitiative(state, task)) {
    return [
      ...listLeadCommands(state, task, id, commands),
      ...listShareCommands(state, task, id, commands, teams),
    ];
  }
  const join = createJoinCommand(state, task, id, teams);
  const adopt: Command[] =
    !task.initiativeId && !task.teamInitiative && commands.has('initiative.adopt_task')
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
  return [
    ...(join ? [join] : []),
    ...listMemberCommands(state, task, id),
    ...listTeamMemberCommands(task, id, teams),
    ...adopt,
  ];
}
