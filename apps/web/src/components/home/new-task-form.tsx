import {
  type PlacementAnswer,
  resolveTaskProject,
  type ShinsaState,
  serializeAttachments,
} from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shinsa/ui/components/select';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { AttachButton, AttachmentChips, useFileDrop } from '@/components/chat/attachment-chips.tsx';
import { SelectField } from '@/components/controls/select-field.tsx';
import { COMPOSER_FIELD, COMPOSER_FOOTER } from '@/components/layout/surface/card.ts';
import { ProjectOption } from '@/components/status/project-dot.tsx';
import { useAttachments } from '@/hooks/use-attachments.ts';
import { canSendDraft } from '@/lib/chat/attachment-drafts.ts';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import {
  connection,
  type MachineChoice,
  NO_UNREACHABLE_MACHINES,
  type UnreachableMachine,
  useConnection,
  useMachines,
  useUnreachableMachines,
} from '@/lib/connection/socket.ts';
import { isSubmitKey } from '@/lib/keys.ts';
import {
  AUTO_CHOICES,
  createNewTaskCommand,
  describeNewTask,
  describePlacementDone,
  hasMachineChoice,
  isProjectOnMachine,
  isWaitingStart,
  listNewTaskMachines,
  listNewTaskPriorities,
  listNewTaskProjects,
  listNewTaskStarts,
  type NewTaskChoices,
  type NewTaskProjectItem,
  NO_PROJECT,
  requestPolicyPlacement,
  resolveNewTaskMachine,
  resolveProjectChoice,
  resolveShownProject,
  useNewTaskRequest,
} from '@/lib/new-task.ts';
import { listOpenTaskChoices } from '@/lib/tasks/roadmap.ts';

const PRIORITY_ITEMS = listNewTaskPriorities();

function listProjectTasks(state: ShinsaState, project: string) {
  return listOpenTaskChoices(state, null).filter(
    (task) => (resolveTaskProject(state, task) ?? NO_PROJECT) === project
  );
}

function ProjectField({
  items,
  value,
  onValueChange,
}: {
  items: NewTaskProjectItem[];
  value: string;
  onValueChange: (value: string) => void;
}) {
  const shown = items.find((item) => item.value === value);
  return (
    <Select
      items={items}
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
    >
      <SelectTrigger aria-label='Project' size='sm' variant='ghost' className='w-fit min-w-0 max-w-56'>
        <SelectValue>{() => shown && <ProjectOption color={shown.color} name={shown.label} />}</SelectValue>
      </SelectTrigger>
      <SelectContent align='start' alignItemWithTrigger={false}>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            <ProjectOption color={item.color} name={item.label} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function resolveForm(state: ShinsaState | null, chosen: NewTaskChoices, machines: MachineChoice[]) {
  const picked = state ? resolveProjectChoice(state, chosen.project) : 'auto';
  const shown = state ? resolveShownProject(state, picked) : NO_PROJECT;
  const placement = resolveNewTaskMachine(machines, { machine: chosen.machine, project: picked }, shown);
  const fits = isProjectOnMachine(machines, placement?.id ?? null, shown);
  const project = fits || picked === 'auto' ? picked : NO_PROJECT;
  const shownProject = fits ? shown : NO_PROJECT;
  const startItems = listNewTaskStarts(state ? listProjectTasks(state, shownProject) : []);
  const choices: NewTaskChoices = {
    ...chosen,
    project,
    start: startItems.some((item) => item.value === chosen.start) ? chosen.start : 'auto',
  };
  return { choices, shownProject, startItems, placement };
}

export function NewTaskFields({
  state,
  chosen,
  machines,
  unreachable = NO_UNREACHABLE_MACHINES,
  onChoose,
}: {
  state: ShinsaState | null;
  chosen: NewTaskChoices;
  machines: MachineChoice[];
  unreachable?: UnreachableMachine[];
  onChoose: (part: Partial<NewTaskChoices>) => void;
}) {
  const { choices, shownProject, startItems, placement } = resolveForm(state, chosen, machines);
  const pickedMachine = choices.machine === 'auto' ? null : choices.machine;
  const projects = state
    ? listNewTaskProjects(state, connection.selectMachine).filter((item) =>
        isProjectOnMachine(machines, pickedMachine, item.value)
      )
    : [];
  return (
    <>
      {hasMachineChoice(machines, unreachable) && (
        <SelectField
          label='Machine'
          size='sm'
          variant='ghost'
          align='start'
          items={listNewTaskMachines(machines, placement, unreachable)}
          value={choices.machine}
          onValueChange={(next) => onChoose({ machine: next })}
          className='min-w-0 max-w-56'
        />
      )}
      {state && (
        <ProjectField
          items={projects}
          value={shownProject}
          onValueChange={(project) => onChoose({ project })}
        />
      )}
      <SelectField
        label='When to start'
        size='sm'
        variant='ghost'
        align='start'
        items={startItems}
        value={choices.start}
        onValueChange={(start) => onChoose({ start })}
        className='min-w-0 max-w-64'
      />
      <SelectField
        label='Priority'
        size='sm'
        variant='ghost'
        align='start'
        items={PRIORITY_ITEMS}
        value={choices.priority}
        onValueChange={(priority) => onChoose({ priority })}
      />
    </>
  );
}

export function NewTaskForm() {
  const { state } = useConnection();
  const machines = useMachines();
  const unreachable = useUnreachableMachines();
  const [request, setRequest] = React.useState('');
  const [chosen, setChosen] = React.useState<NewTaskChoices>(AUTO_CHOICES);
  const [busy, setBusy] = React.useState(false);
  const field = React.useRef<HTMLTextAreaElement>(null);
  const { choices, placement } = resolveForm(state, chosen, machines);
  const attachments = useAttachments();
  const { dragging, dropProps, onPaste } = useFileDrop(attachments);
  const ready = canSendDraft(request, attachments.drafts, busy);
  const copy = describeNewTask(isWaitingStart(choices.start));
  const choose = (part: Partial<NewTaskChoices>) => setChosen((current) => ({ ...current, ...part }));
  useNewTaskRequest((draft) => {
    if (draft) setRequest(draft);
    requestAnimationFrame(() => {
      const element = field.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(element.value.length, element.value.length);
    });
  });

  async function submit() {
    if (!ready) return;
    setBusy(true);
    let answer: PlacementAnswer | null = null;
    if (placement?.byPolicy) answer = await requestPolicyPlacement(machines, request);
    const machineId = answer?.machineId ?? placement?.id ?? null;
    const sent = await sendCommandWithToast(
      createNewTaskCommand(serializeAttachments(request, attachments.ready), choices),
      placement
        ? describePlacementDone(
            copy.done,
            machines.find((machine) => machine.id === machineId),
            answer?.reason ?? ''
          )
        : copy.done,
      machineId
    );
    setBusy(false);
    if (!sent) return;
    setRequest('');
    attachments.clear();
    setChosen(AUTO_CHOICES);
  }

  return (
    <div {...dropProps} className={cn('flex w-full flex-col', dragging && 'bg-primary-a1')}>
      <AttachmentChips attachments={attachments} />
      <textarea
        ref={field}
        value={request}
        onChange={(event) => setRequest(event.target.value)}
        onPaste={onPaste}
        onKeyDown={(event) => {
          if (!isSubmitKey(event)) return;
          event.preventDefault();
          void submit();
        }}
        aria-label='Describe the work'
        placeholder={copy.placeholder}
        className={cn(COMPOSER_FIELD, 'max-h-72 min-h-20')}
      />
      <div className={cn(COMPOSER_FOOTER, 'flex-wrap')}>
        <AttachButton attachments={attachments} />
        <NewTaskFields
          state={state}
          chosen={chosen}
          machines={machines}
          unreachable={unreachable}
          onChoose={choose}
        />
        <span className='flex-1' />
        <Button size='sm' disabled={!ready} loading={busy} onClick={() => void submit()}>
          {copy.submit}
        </Button>
      </div>
    </div>
  );
}
