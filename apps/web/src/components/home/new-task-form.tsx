import { type ShinsaState, serializeAttachments, type Task } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import {
  Command,
  CommandEmpty,
  CommandHint,
  CommandInput,
  CommandItem,
  CommandList,
} from '@shinsa/ui/components/command';
import { Icon } from '@shinsa/ui/components/icon';
import { Popover, PopoverContent } from '@shinsa/ui/components/popover';
import { ScrollFade } from '@shinsa/ui/components/scroll-fade';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shinsa/ui/components/select';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { AttachButton, AttachmentChips, useFileDrop } from '@/components/chat/attachment-chips.tsx';
import { SelectField } from '@/components/controls/select-field.tsx';
import { COMPOSER_FIELD, COMPOSER_FOOTER } from '@/components/layout/surface/card.ts';
import { ProjectOption } from '@/components/status/project-dot.tsx';
import { useAttachments } from '@/hooks/use-attachments.ts';
import { canSendDraft } from '@/lib/chat/attachment-drafts.ts';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { useConnection } from '@/lib/connection/socket.ts';
import { isSubmitKey } from '@/lib/keys.ts';
import {
  AUTO_CHOICES,
  createNewTaskCommand,
  describeNewTask,
  listNewTaskPriorities,
  listNewTaskProjects,
  listNewTaskStarts,
  type NewTaskChoices,
  type NewTaskProjectItem,
  NO_PROJECT,
  resolveProjectChoice,
  resolveShownProject,
  resolveStartChoice,
  toggleAfterTask,
  useNewTaskRequest,
} from '@/lib/new-task.ts';
import { listOpenTaskChoices } from '@/lib/tasks/groups.ts';
import { resolveTaskMenuIcon } from '@/lib/tasks/status.ts';

const PRIORITY_ITEMS = listNewTaskPriorities();

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

function resolveForm(state: ShinsaState | null, chosen: NewTaskChoices) {
  const project = state ? resolveProjectChoice(state, chosen.project) : 'auto';
  const shownProject = state ? resolveShownProject(state, project) : NO_PROJECT;
  const open = state ? listOpenTaskChoices(state, null) : [];
  const choices: NewTaskChoices = { ...chosen, project, ...resolveStartChoice(chosen, open) };
  return { choices, shownProject, open };
}

function AfterTaskList({
  state,
  open,
  after,
  onToggle,
}: {
  state: ShinsaState;
  open: Task[];
  after: string[];
  onToggle: (taskId: string) => void;
}) {
  return (
    <Command>
      <CommandInput placeholder='Search open tasks' aria-label='Search open tasks' />
      <CommandList>
        <CommandEmpty>No open task matches.</CommandEmpty>
        {open.map((task) => (
          <CommandItem
            key={task.id}
            value={`${task.handle ?? ''} ${task.title} ${task.id}`}
            icon={resolveTaskMenuIcon(state, task)}
            onSelect={() => onToggle(task.id)}
          >
            <Truncate className='min-w-0 flex-1'>{task.title}</Truncate>
            {task.handle && <CommandHint className='shrink-0'>{task.handle}</CommandHint>}
            <Icon
              name='IconCheckmark1Small'
              className={cn('shrink-0 text-primary', !after.includes(task.id) && 'invisible')}
            />
          </CommandItem>
        ))}
      </CommandList>
    </Command>
  );
}

function StartField({
  state,
  open,
  choices,
  onChoose,
}: {
  state: ShinsaState | null;
  open: Task[];
  choices: NewTaskChoices;
  onChoose: (part: Partial<NewTaskChoices>) => void;
}) {
  const [picking, setPicking] = React.useState(false);
  const anchor = React.useRef<HTMLSpanElement>(null);
  return (
    <span ref={anchor} className='flex min-w-0'>
      <SelectField
        label='When to start'
        size='sm'
        variant='ghost'
        align='start'
        items={listNewTaskStarts(open, choices.after)}
        value={choices.start}
        onValueChange={(start) => {
          if (start === 'after') setPicking(true);
          else onChoose({ start, after: [] });
        }}
        className='min-w-0 max-w-64'
      />
      {state && (
        <Popover open={picking} onOpenChange={setPicking}>
          <PopoverContent anchor={anchor} align='start' className='w-80 overflow-hidden p-0'>
            <AfterTaskList
              state={state}
              open={open}
              after={choices.after}
              onToggle={(taskId) => onChoose(toggleAfterTask(choices.after, taskId))}
            />
          </PopoverContent>
        </Popover>
      )}
    </span>
  );
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
  const { choices, shownProject, open } = resolveForm(state, chosen);
  return (
    <>
      {state && (
        <ProjectField
          items={listNewTaskProjects(state)}
          value={shownProject}
          onValueChange={(project) => onChoose({ project })}
        />
      )}
      <StartField state={state} open={open} choices={choices} onChoose={onChoose} />
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
  const attachments = useAttachments();
  const { dragging, dropProps, onPaste } = useFileDrop(attachments);
  const ready = canSendDraft(request, attachments.drafts, busy);
  const copy = describeNewTask(choices.start);
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
    const sent = await sendCommandWithToast(
      createNewTaskCommand(serializeAttachments(request, attachments.ready), choices),
      copy.done
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
      <ScrollFade targetRef={field} />
      <div className={cn(COMPOSER_FOOTER, 'flex-wrap')}>
        <AttachButton attachments={attachments} />
        <NewTaskFields state={state} chosen={chosen} onChoose={choose} />
        <span className='flex-1' />
        <Button size='sm' disabled={!ready} loading={busy} onClick={() => void submit()}>
          {copy.submit}
        </Button>
      </div>
    </div>
  );
}
