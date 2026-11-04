import { canChangeStack, isTaskSettled, type ShinsaState, type Task } from '@shinsa/core';
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
import { Icon, type IconName } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { BUNDLE_ICON, listStackChoices, STACK_LABEL, toggleStack, unstackTask } from '@/lib/tasks/bundles.ts';
import {
  clearDependencies,
  describeWaitsOnHeading,
  listDependencyChoices,
  resolveDependencyLabel,
  toggleDependency,
} from '@/lib/tasks/dependencies.ts';
import { resolveTaskMenuIcon, resolveTaskStatus } from '@/lib/tasks/status.ts';
import { navigate, resolveTaskPath } from '@/router.ts';

interface TaskChoiceSubProps {
  state: ShinsaState;
  icon: IconName;
  label: string;
  choices: Task[];
  isChecked: (choice: Task) => boolean;
  onToggle: (choice: Task) => void;
}

function TaskChoiceSub({ state, icon, label, choices, isChecked, onToggle }: TaskChoiceSubProps) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Icon name={icon} />
        {label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className='max-h-80 max-w-80 overflow-y-auto'>
        {choices.map((choice) => {
          const choiceIcon = resolveTaskMenuIcon(state, choice);
          return (
            <DropdownMenuCheckboxItem
              key={choice.id}
              checked={isChecked(choice)}
              onCheckedChange={() => onToggle(choice)}
            >
              <Icon name={choiceIcon.name} className={choiceIcon.className} />
              <Truncate>{choice.title}</Truncate>
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

export function DependencyItems({ state, task }: { state: ShinsaState; task: Task }) {
  if (isTaskSettled(task)) return null;
  const choices = listDependencyChoices(state, task);
  return (
    <>
      {choices.length > 0 && (
        <TaskChoiceSub
          state={state}
          icon='IconHourglass'
          label={resolveDependencyLabel(task)}
          choices={choices}
          isChecked={(choice) => task.waitsOn.includes(choice.id)}
          onToggle={(choice) => void toggleDependency(task, choice)}
        />
      )}
      {task.waitsOn.length > 0 && (
        <DropdownMenuItem icon='IconCrossMedium' onClick={() => void clearDependencies(task)}>
          Stop waiting
        </DropdownMenuItem>
      )}
      <StackItems state={state} task={task} />
    </>
  );
}

function StackItems({ state, task }: { state: ShinsaState; task: Task }) {
  const choices = listStackChoices(state, task);
  return (
    <>
      {choices.length > 0 && (
        <TaskChoiceSub
          state={state}
          icon={BUNDLE_ICON}
          label={STACK_LABEL}
          choices={choices}
          isChecked={(choice) => task.stacksOn === choice.id}
          onToggle={(choice) => void toggleStack(task, choice)}
        />
      )}
      {task.stacksOn && canChangeStack(task) && (
        <DropdownMenuItem icon='IconCrossMedium' onClick={() => void unstackTask(task)}>
          Take out of the bundle
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
