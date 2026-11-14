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
  closeMoveDialog,
  listMoveChoices,
  MOVE_DESCRIPTION,
  MOVE_TITLE,
  moveTask,
  resolveMoveChoiceValue,
  useMoveDialog,
} from '@/lib/tasks/move.ts';

export function MoveDialog() {
  const taskId = useMoveDialog();
  const state = useShinsaState();
  const task = taskId && state ? state.tasks[taskId] : undefined;
  const choices = React.useMemo(() => (state && task ? listMoveChoices(state, task) : []), [state, task]);
  return (
    <CommandDialog
      open={Boolean(task)}
      onOpenChange={(next) => {
        if (!next) closeMoveDialog();
      }}
      title={MOVE_TITLE}
      description={MOVE_DESCRIPTION}
    >
      <Command>
        <CommandInput placeholder='Find a repository' aria-label='Find a repository' />
        <CommandList>
          <CommandEmpty>No repository matches.</CommandEmpty>
          {state &&
            task &&
            choices.map((choice) => (
              <CommandItem
                key={choice.repo.id}
                value={resolveMoveChoiceValue(state, choice.repo)}
                icon='IconFolder1'
                onSelect={() => {
                  closeMoveDialog();
                  void moveTask(task, choice.repo);
                }}
              >
                <span className='min-w-0 truncate'>{choice.repo.name}</span>
                <CommandHint>{choice.hint}</CommandHint>
              </CommandItem>
            ))}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
