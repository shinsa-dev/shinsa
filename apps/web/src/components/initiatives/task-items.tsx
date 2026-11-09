import { NO_PHASE_NAME, type ShinsaState, type Task } from '@shinsa/core';
import {
  DropdownMenuItem,
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
import { Hint } from '@/components/overlays/hint.tsx';
import { FACT, FACT_INTERACTIVE } from '@/components/task/fact.ts';
import { useEngineCommand } from '@/lib/connection/socket.ts';
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
import { INITIATIVE_ICON, NO_PHASE_VALUE } from '@/lib/initiatives/view.ts';
import { navigate, resolveTaskPath } from '@/router.ts';

function LeadItems({ initiativeId }: { initiativeId: string }) {
  const writable = useEngineCommand('initiative.write');
  if (!writable) return null;
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem icon='IconPencil' onClick={() => openInitiativeDialog(initiativeId)}>
        Edit the initiative
      </DropdownMenuItem>
    </>
  );
}

export function InitiativeItems({ state, task }: { state: ShinsaState; task: Task }) {
  const joinable = useEngineCommand('task.join_initiative', task.id);
  const adoptable = useEngineCommand('initiative.adopt_task', task.id);
  const led = selectLedInitiative(state, task);
  if (led) return <LeadItems initiativeId={led.id} />;
  if (!joinable) return null;
  const current = selectTaskInitiative(state, task);
  const choices = listInitiativeChoices(state, task);
  return (
    <>
      <DropdownMenuSeparator />
      {choices.length > 0 && (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Icon name={INITIATIVE_ICON} />
            {current ? MOVE_TO_INITIATIVE : ADD_TO_INITIATIVE}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className='max-h-80 max-w-80 overflow-y-auto'>
            {choices.map((initiative) => (
              <DropdownMenuItem key={initiative.id} onClick={() => void joinInitiative(task, initiative)}>
                <Truncate>{initiative.name}</Truncate>
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )}
      {current && current.phases.length > 0 && (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Icon name='IconLayersThree' />
            {PHASE_LABEL}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className='max-h-80 max-w-80 overflow-y-auto'>
            <DropdownMenuRadioGroup
              value={task.initiativePhaseId ?? NO_PHASE_VALUE}
              onValueChange={(value) => void changeTaskPhase(task, current, String(value) || null)}
            >
              {current.phases.map((phase) => (
                <DropdownMenuRadioItem key={phase.id} value={phase.id}>
                  <Truncate>{phase.name}</Truncate>
                </DropdownMenuRadioItem>
              ))}
              <DropdownMenuRadioItem value={NO_PHASE_VALUE}>{NO_PHASE_NAME}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )}
      {current ? (
        <DropdownMenuItem icon='IconCrossMedium' onClick={() => void leaveInitiative(task, current)}>
          {LEAVE_INITIATIVE}
        </DropdownMenuItem>
      ) : (
        adoptable && (
          <DropdownMenuItem icon={INITIATIVE_ICON} onClick={() => void adoptTask(task)}>
            {ADOPT_TASK}
          </DropdownMenuItem>
        )
      )}
    </>
  );
}

export function InitiativeFact({ state, task }: { state: ShinsaState; task: Task }) {
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
