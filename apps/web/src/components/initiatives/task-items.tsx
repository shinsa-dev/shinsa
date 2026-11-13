import {
  type Initiative,
  type InitiativePhase,
  NO_PHASE_NAME,
  type ShinsaState,
  type Task,
} from '@shinsa/core';
import {
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@shinsa/ui/components/dropdown-menu';
import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import { TEAM_ICON } from '@/components/focus/menu.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { FACT, FACT_INTERACTIVE } from '@/components/task/fact.ts';
import { useEngineCommand, useRemoteSnapshot, useTeamFeed } from '@/lib/connection/socket.ts';
import { listFocusTeams } from '@/lib/focus.ts';
import { openInitiativeDialog } from '@/lib/initiatives/draft.ts';
import { selectLedInitiative } from '@/lib/initiatives/lead.ts';
import {
  ADD_TO_INITIATIVE,
  ADOPT_TASK,
  adoptTask,
  changeTaskPhase,
  describeTaskInitiative,
  joinInitiative,
  LEAVE_INITIATIVE,
  leaveInitiative,
  listInitiativeChoices,
  MOVE_TO_INITIATIVE,
  PHASE_LABEL,
  selectTaskInitiative,
} from '@/lib/initiatives/membership.ts';
import {
  changeTeamPhase,
  describeTeamInitiativeLabel,
  joinTeamInitiative,
  leaveTeamInitiative,
  listTeamInitiativeChoices,
  listTeamShareChoices,
  resolveTeamLeadPath,
  SHARE_WITH_TEAM,
  selectTaskTeamInitiative,
  shareInitiative,
  TEAMMATE_INITIATIVE_AWAY,
  TEAMMATE_INITIATIVES,
} from '@/lib/initiatives/team.ts';
import { INITIATIVE_ICON, NO_PHASE_VALUE } from '@/lib/initiatives/view.ts';
import { navigate, resolveTaskPath } from '@/router.ts';

function ShareItems({ initiative }: { initiative: Initiative }) {
  const shareable = useEngineCommand('initiative.add_to_team');
  const remote = useRemoteSnapshot();
  const teams = listFocusTeams(remote);
  if (!shareable || teams.length === 0) return null;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Icon name={TEAM_ICON} />
        {SHARE_WITH_TEAM}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className='max-h-80 max-w-80 overflow-y-auto'>
        {listTeamShareChoices(initiative, teams).map(({ team, shared }) => (
          <DropdownMenuCheckboxItem
            key={team.id}
            checked={shared}
            onCheckedChange={(checked) => void shareInitiative(initiative, team, checked)}
          >
            <Truncate>{team.name}</Truncate>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function LeadItems({ initiative }: { initiative: Initiative }) {
  const writable = useEngineCommand('initiative.write');
  return (
    <>
      <DropdownMenuSeparator />
      {writable && (
        <DropdownMenuItem icon='IconPencil' onClick={() => openInitiativeDialog(initiative.id)}>
          Edit the initiative
        </DropdownMenuItem>
      )}
      <ShareItems initiative={initiative} />
    </>
  );
}

function PhaseItems({
  phases,
  value,
  onPick,
}: {
  phases: readonly InitiativePhase[];
  value: string | null;
  onPick: (phaseId: string | null) => void;
}) {
  if (phases.length === 0) return null;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Icon name='IconLayersThree' />
        {PHASE_LABEL}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className='max-h-80 max-w-80 overflow-y-auto'>
        <DropdownMenuRadioGroup
          value={value ?? NO_PHASE_VALUE}
          onValueChange={(next) => onPick(String(next) || null)}
        >
          {phases.map((phase) => (
            <DropdownMenuRadioItem key={phase.id} value={phase.id}>
              <Truncate>{phase.name}</Truncate>
            </DropdownMenuRadioItem>
          ))}
          <DropdownMenuRadioItem value={NO_PHASE_VALUE}>{NO_PHASE_NAME}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

export function InitiativeItems({ state, task }: { state: ShinsaState; task: Task }) {
  const joinable = useEngineCommand('task.join_initiative', task.id);
  const adoptable = useEngineCommand('initiative.adopt_task', task.id);
  const remote = useRemoteSnapshot();
  const feed = useTeamFeed();
  const led = selectLedInitiative(state, task);
  if (led) return <LeadItems initiative={led} />;
  if (!joinable) return null;
  const current = selectTaskInitiative(state, task);
  const teamCurrent = selectTaskTeamInitiative(feed, task);
  const inTeam = Boolean(task.teamInitiative);
  const choices = listInitiativeChoices(state, task);
  const teamChoices = listTeamInitiativeChoices(feed, listFocusTeams(remote), task);
  return (
    <>
      <DropdownMenuSeparator />
      {choices.length + teamChoices.length > 0 && (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Icon name={INITIATIVE_ICON} />
            {current || inTeam ? MOVE_TO_INITIATIVE : ADD_TO_INITIATIVE}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className='max-h-80 max-w-80 overflow-y-auto'>
            {choices.map((initiative) => (
              <DropdownMenuItem key={initiative.id} onClick={() => void joinInitiative(task, initiative)}>
                <Truncate>{initiative.name}</Truncate>
              </DropdownMenuItem>
            ))}
            {teamChoices.length > 0 && choices.length > 0 && <DropdownMenuSeparator />}
            {teamChoices.length > 0 && (
              <DropdownMenuGroup>
                <DropdownMenuLabel>{TEAMMATE_INITIATIVES}</DropdownMenuLabel>
                {teamChoices.map((initiative) => (
                  <DropdownMenuItem
                    key={`${initiative.instanceId}:${initiative.id}`}
                    onClick={() => void joinTeamInitiative(task, initiative)}
                  >
                    <Truncate>{initiative.name}</Truncate>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )}
      {current && (
        <PhaseItems
          phases={current.phases}
          value={task.initiativePhaseId ?? null}
          onPick={(phaseId) => void changeTaskPhase(task, current, phaseId)}
        />
      )}
      {teamCurrent && (
        <PhaseItems
          phases={teamCurrent.phases}
          value={task.teamInitiative?.phaseId ?? null}
          onPick={(phaseId) => void changeTeamPhase(task, teamCurrent, phaseId)}
        />
      )}
      {current && (
        <DropdownMenuItem icon='IconCrossMedium' onClick={() => void leaveInitiative(task, current)}>
          {LEAVE_INITIATIVE}
        </DropdownMenuItem>
      )}
      {inTeam && (
        <DropdownMenuItem icon='IconCrossMedium' onClick={() => void leaveTeamInitiative(task)}>
          {LEAVE_INITIATIVE}
        </DropdownMenuItem>
      )}
      {!current && !inTeam && adoptable && (
        <DropdownMenuItem icon={INITIATIVE_ICON} onClick={() => void adoptTask(task)}>
          {ADOPT_TASK}
        </DropdownMenuItem>
      )}
    </>
  );
}

function TeamInitiativeFact({ task }: { task: Task }) {
  const feed = useTeamFeed();
  const ref = task.teamInitiative;
  if (!ref) return null;
  const initiative = selectTaskTeamInitiative(feed, task);
  const label = initiative ? describeTeamInitiativeLabel(initiative, ref.phaseId) : ref.name;
  return (
    <Hint label={initiative ? 'Open the teammate’s initiative' : TEAMMATE_INITIATIVE_AWAY}>
      <button
        type='button'
        disabled={!initiative}
        className={cn(FACT, initiative && FACT_INTERACTIVE, 'max-w-72')}
        onClick={() => initiative && navigate(resolveTeamLeadPath(initiative))}
      >
        <Icon size='sm' name={INITIATIVE_ICON} />
        <span className='truncate'>{label}</span>
      </button>
    </Hint>
  );
}

export function InitiativeFact({ state, task }: { state: ShinsaState; task: Task }) {
  if (task.teamInitiative) return <TeamInitiativeFact task={task} />;
  const member = describeTaskInitiative(state, task);
  const lead = member?.initiative.leadTaskId ? state.tasks[member.initiative.leadTaskId] : undefined;
  if (!member || !lead || lead.id === task.id) return null;
  return (
    <Hint label='Open the initiative'>
      <button
        type='button'
        className={cn(FACT, FACT_INTERACTIVE, 'max-w-72')}
        onClick={() => navigate(resolveTaskPath(lead))}
      >
        <Icon size='sm' name={INITIATIVE_ICON} />
        <span className='truncate'>{member.label}</span>
      </button>
    </Hint>
  );
}
