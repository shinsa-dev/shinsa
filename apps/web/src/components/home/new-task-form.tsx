import { resolveTaskProject, type ShinsaState } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shinsa/ui/components/select';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { SelectField } from '@/components/controls/select-field.tsx';
import { COMPOSER_FIELD, COMPOSER_FOOTER } from '@/components/layout/surface/card.ts';
import { ProjectDotIcon } from '@/components/status/project-dot.tsx';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { useConnection } from '@/lib/connection/socket.ts';
import { isSubmitKey } from '@/lib/keys.ts';
import {
  AUTO_CHOICES,
  createNewTaskCommand,
  describeNewTask,
  isWaitingStart,
  listNewTaskPriorities,
  listNewTaskProjects,
  listNewTaskStarts,
  type NewTaskChoices,
  type NewTaskProjectItem,
  NO_PROJECT,
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

function ProjectOption({ item }: { item: NewTaskProjectItem }) {
  return (
    <>
      <ProjectDotIcon color={item.color} />
      <span className='truncate'>{item.label}</span>
    </>
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
        <SelectValue>{() => shown && <ProjectOption item={shown} />}</SelectValue>
      </SelectTrigger>
      <SelectContent align='start' alignItemWithTrigger={false}>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            <ProjectOption item={item} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function resolveForm(state: ShinsaState | null, chosen: NewTaskChoices) {
  const project = state ? resolveProjectChoice(state, chosen.project) : 'auto';
  const shownProject = state ? resolveShownProject(state, project) : NO_PROJECT;
  const startItems = listNewTaskStarts(state ? listProjectTasks(state, shownProject) : []);
  const choices: NewTaskChoices = {
    ...chosen,
    project,
    start: startItems.some((item) => item.value === chosen.start) ? chosen.start : 'auto',
  };
  return { choices, shownProject, startItems };
}

export function NewTaskFields({
  state,
  chosen,
  onChoose,
}: {
  state: ShinsaState | null;
  chosen: NewTaskChoices;
  onChoose: (part: Partial<NewTaskChoices>) => void;
}) {
  const { choices, shownProject, startItems } = resolveForm(state, chosen);
  return (
    <>
      {state && (
        <ProjectField
          items={listNewTaskProjects(state)}
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
  const [request, setRequest] = React.useState('');
  const [chosen, setChosen] = React.useState<NewTaskChoices>(AUTO_CHOICES);
  const [busy, setBusy] = React.useState(false);
  const field = React.useRef<HTMLTextAreaElement>(null);
  const { choices } = resolveForm(state, chosen);
  const ready = request.trim().length > 0 && !busy;
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
    const sent = await sendCommandWithToast(createNewTaskCommand(request, choices), copy.done);
    setBusy(false);
    if (!sent) return;
    setRequest('');
    setChosen(AUTO_CHOICES);
  }

  return (
    <div className='flex w-full flex-col'>
      <textarea
        ref={field}
        value={request}
        onChange={(event) => setRequest(event.target.value)}
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
        <NewTaskFields state={state} chosen={chosen} onChoose={choose} />
        <span className='flex-1' />
        <Button size='sm' disabled={!ready} loading={busy} onClick={() => void submit()}>
          {copy.submit}
        </Button>
      </div>
    </div>
  );
}
