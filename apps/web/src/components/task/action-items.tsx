import { TASK_PRIORITIES, type Task, type TaskPriority } from '@shinsa/core';
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from '@shinsa/ui/components/dropdown-menu';
import * as React from 'react';
import { PriorityIcon } from '@/components/status/priority-icon.tsx';
import { PRIORITY_LABEL } from '@/lib/format/labels.ts';
import { listTaskActions, runTaskAction, TASK_ACTION, updatePriority } from '@/lib/tasks/actions.ts';

export function PriorityChoices({ task }: { task: Task }) {
  return (
    <DropdownMenuRadioGroup
      value={task.priority}
      onValueChange={(priority) => void updatePriority(task, priority as TaskPriority)}
    >
      <DropdownMenuLabel>Priority</DropdownMenuLabel>
      {TASK_PRIORITIES.map((priority) => (
        <DropdownMenuRadioItem key={priority} value={priority}>
          <PriorityIcon priority={priority} />
          {PRIORITY_LABEL[priority]}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

export function TaskActionItems({ task }: { task: Task }) {
  return listTaskActions(task).map((group, index) => (
    <React.Fragment key={group.join()}>
      {index > 0 && <DropdownMenuSeparator />}
      <DropdownMenuGroup>
        {group.map((key) => (
          <DropdownMenuItem
            key={key}
            icon={TASK_ACTION[key].icon}
            variant={key === 'cancel' ? 'destructive' : 'default'}
            onClick={() => runTaskAction(task, key)}
          >
            {TASK_ACTION[key].label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuGroup>
    </React.Fragment>
  ));
}
