import { isTaskSettled, type ShinsaState, selectStackedOnTask, type Task } from '@shinsa/core';
import {
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@shinsa/ui/components/dropdown-menu';
import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import {
  clearDependencies,
  describeWaitsOnHeading,
  hasRemovableDependencies,
  listDependencyChoices,
  resolveDependencyChoiceLabel,
  resolveDependencyLabel,
  toggleDependency,
} from '@/lib/tasks/dependencies.ts';
import { resolveTaskMenuIcon, resolveTaskStatus } from '@/lib/tasks/status.ts';
import { navigate, resolveTaskPath } from '@/router.ts';

export function DependencyItems({ state, task }: { state: ShinsaState; task: Task }) {
  if (isTaskSettled(task)) return null;
  const choices = listDependencyChoices(state, task);
  const stackedOn = selectStackedOnTask(state, task);
  return (
    <>
      {choices.length > 0 && (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Icon name='IconHourglass' />
            {resolveDependencyLabel(task)}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className='max-h-80 max-w-80 overflow-y-auto'>
            {choices.map((choice) => {
              const icon = resolveTaskMenuIcon(state, choice);
              return (
                <DropdownMenuCheckboxItem
                  key={choice.id}
                  checked={task.waitsOn.includes(choice.id)}
                  disabled={stackedOn?.id === choice.id}
                  onCheckedChange={() => void toggleDependency(task, choice)}
                >
                  <Icon name={icon.name} className={icon.className} />
                  <Truncate>{resolveDependencyChoiceLabel(stackedOn, choice)}</Truncate>
                </DropdownMenuCheckboxItem>
              );
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )}
      {hasRemovableDependencies(task, stackedOn) && (
        <DropdownMenuItem icon='IconCrossMedium' onClick={() => void clearDependencies(task, stackedOn)}>
          Stop waiting
        </DropdownMenuItem>
      )}
    </>
  );
}

export function WaitsOnItems({ state, task, waitsOn }: { state: ShinsaState; task: Task; waitsOn: Task[] }) {
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuLabel>{describeWaitsOnHeading(task, waitsOn)}</DropdownMenuLabel>
        {waitsOn.map((blocker) => (
          <DropdownMenuItem
            key={blocker.id}
            icon={resolveTaskMenuIcon(state, blocker)}
            onClick={() => navigate(resolveTaskPath(blocker))}
          >
            <Truncate>{blocker.title}</Truncate>
            <span className='ms-auto shrink-0 ps-3 text-fg-2'>{resolveTaskStatus(state, blocker).label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DependencyItems state={state} task={task} />
    </>
  );
}
