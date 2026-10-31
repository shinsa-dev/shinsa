import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandHint,
  CommandInput,
  CommandItem,
  CommandList,
} from '@shinsa/ui/components/command';
import * as React from 'react';
import { useShinsaState } from '@/lib/connection/selectors.ts';
import {
  closeAsDuplicate,
  closeDuplicateDialog,
  DUPLICATE_DESCRIPTION,
  DUPLICATE_TITLE,
  listDuplicateChoices,
  resolveDuplicateChoiceValue,
  useDuplicateDialog,
} from '@/lib/tasks/duplicate.ts';
import { resolveRowStatus, resolveTaskStatusIcon } from '@/lib/tasks/status.ts';

export function DuplicateDialog() {
  const taskId = useDuplicateDialog();
  const state = useShinsaState();
  const task = taskId && state ? state.tasks[taskId] : undefined;
  const choices = React.useMemo(
    () => (state && task ? listDuplicateChoices(state, task) : []),
    [state, task]
  );
  return (
    <CommandDialog
      open={Boolean(task)}
      onOpenChange={(next) => {
        if (!next) closeDuplicateDialog();
      }}
      title={DUPLICATE_TITLE}
      description={DUPLICATE_DESCRIPTION}
    >
      <Command>
        <CommandInput
          placeholder='Find the task this one repeats'
          aria-label='Find the task this one repeats'
        />
        <CommandList>
          <CommandEmpty>No task matches.</CommandEmpty>
          {state &&
            task &&
            choices.map((choice) => (
              <CommandItem
                key={choice.id}
                value={resolveDuplicateChoiceValue(choice)}
                icon={resolveTaskStatusIcon(state, choice)}
                onSelect={() => {
                  closeDuplicateDialog();
                  void closeAsDuplicate(task, choice);
                }}
              >
                <span className='min-w-0 truncate'>
                  {choice.handle && <span className='me-1.5 text-fg-2 tabular-nums'>{choice.handle}</span>}
                  {choice.title}
                </span>
                <CommandHint>{resolveRowStatus(state, choice).label}</CommandHint>
              </CommandItem>
            ))}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
