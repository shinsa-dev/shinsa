import type { ShinsaState, Task } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandHint,
  CommandInput,
  CommandItem,
  CommandList,
} from '@shinsa/ui/components/command';
import { Icon } from '@shinsa/ui/components/icon';
import { Kbd } from '@shinsa/ui/components/kbd';
import { Truncate } from '@shinsa/ui/components/truncate';
import * as React from 'react';
import { Hint } from '@/components/overlays/hint.tsx';
import { SelectedMark } from '@/components/status/check-mark.tsx';
import { ProjectDotIcon } from '@/components/status/project-dot.tsx';
import { useCommandHotkey, useCommandKey } from '@/hooks/use-command-key.ts';
import { listAccountSections } from '@/lib/command/accounts.ts';
import { listExtensionSections } from '@/lib/command/extensions.ts';
import { listGlobalSections } from '@/lib/command/global.ts';
import {
  arrangeByScore,
  type ChoiceCommand,
  COMPOSE_VALUE,
  type Frame,
  JUMP_KEYWORDS,
  JUMP_VALUE,
  listCommandKeywords,
  listMenuTasks,
  listOptionKeywords,
  listRootBlocks,
  listSectionBlocks,
  listTaskKeywords,
  type MenuBlock,
  NEW_TASK_COMMAND,
  requestNewTaskOnHome,
  resolveCrumb,
  resolveFirstValue,
  resolvePlaceholder,
  resolveRepoName,
  TASKS_FRAME,
  type Visit,
} from '@/lib/command/menu.ts';
import {
  type ChoiceOption,
  isChosen,
  isDisabled,
  type Command as MenuCommand,
  useCommandMenuOpen,
  useRegisteredSections,
  writeCommandMenuOpen,
} from '@/lib/command/registry.ts';
import { listScheduleSections } from '@/lib/command/schedules.ts';
import { FALLBACK_PREFIX, scoreCommand } from '@/lib/command/score.ts';
import { resolveTaskPage } from '@/lib/command/task.ts';
import { listVersionSections } from '@/lib/command/versions.ts';
import { useAccounts } from '@/lib/connection/accounts.ts';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { useExtensions } from '@/lib/connection/extensions.ts';
import { useConnection } from '@/lib/connection/socket.ts';
import { useVersions } from '@/lib/connection/versions.ts';
import { describeNewTask } from '@/lib/new-task.ts';
import { useLayoutPreference } from '@/lib/preferences/layout.ts';
import { listRecentTaskIds, recordRecentTask } from '@/lib/preferences/recent-tasks.ts';
import { useThemePreference } from '@/lib/preferences/theme.ts';
import { resolveSelectedTask } from '@/lib/tasks/prefetch.ts';
import { resolveHandleText } from '@/lib/tasks/rounds.ts';
import { resolveTaskMenuIcon, resolveTaskStatus } from '@/lib/tasks/status.ts';
import { navigate, resolveTaskPath, useRoute, useRouteTaskId } from '@/router.ts';
import { prefetchTask } from '@/routes/task/prefetch.tsx';

function Crumb({ children }: { children: string }) {
  return (
    <span className='-ms-1 inline-flex h-5.5 min-w-0 max-w-48 shrink-0 items-center rounded-control-sm bg-bg-2 px-1 font-medium text-fg-3 text-xs'>
      <Truncate className='min-w-0'>{children}</Truncate>
    </span>
  );
}

function Status({ children }: { children: string }) {
  return <span className='ms-auto shrink-0 ps-3 font-normal text-fg-2'>{children}</span>;
}

function Trailing({ command }: { command: MenuCommand }) {
  if (command.current) return <SelectedMark className='ms-auto' />;
  if (command.kind === 'page' || command.kind === 'choice')
    return <Icon name='IconChevronRightMedium' className='ms-auto' />;
  if (command.kind === 'link') return <Icon name='IconArrowUpRight' className='ms-auto' />;
  return null;
}

function CommandRow({
  command,
  state,
  onSelect,
}: {
  command: MenuCommand;
  state: ShinsaState;
  onSelect: (command: MenuCommand) => void;
}) {
  const task = command.taskId ? state.tasks[command.taskId] : undefined;
  const hint = command.disabled ?? command.hint;
  return (
    <CommandItem
      value={command.id}
      keywords={listCommandKeywords(command)}
      icon={task ? resolveTaskMenuIcon(state, task) : command.icon}
      disabled={isDisabled(command)}
      onSelect={() => onSelect(command)}
      variant={command.destructive ? 'destructive' : 'default'}
    >
      <Truncate className='min-w-0'>{command.label}</Truncate>
      {hint && <CommandHint className='min-w-12 shrink-[4]'>{hint}</CommandHint>}
      {command.trailing && <Status>{command.trailing}</Status>}
      <Trailing command={command} />
    </CommandItem>
  );
}

function OptionDot({ option }: { option: ChoiceOption }) {
  if (!option.dot) return null;
  return <ProjectDotIcon color={option.dot} />;
}

function ChoiceRows({
  command,
  flat,
  onPick,
}: {
  command: ChoiceCommand;
  flat: boolean;
  onPick: (command: ChoiceCommand, value: string) => void;
}) {
  return command.options.map((option) => (
    <CommandItem
      key={option.value}
      value={`${command.id}:${option.value}`}
      keywords={listOptionKeywords(command, option)}
      icon={option.icon}
      disabled={isDisabled(option)}
      onSelect={() => onPick(command, option.value)}
    >
      <OptionDot option={option} />
      <Truncate className='min-w-0'>{option.label}</Truncate>
      {option.disabled ? (
        <CommandHint className='min-w-12 shrink-[4]'>{option.disabled}</CommandHint>
      ) : (
        flat && <CommandHint>{command.heading}</CommandHint>
      )}
      {isChosen(command, option.value) && <SelectedMark className='ms-auto' />}
    </CommandItem>
  ));
}

function TaskRow({
  state,
  task,
  value,
  onGo,
}: {
  state: ShinsaState;
  task: Task;
  value: string;
  onGo: () => void;
}) {
  const status = resolveTaskStatus(state, task);
  const repo = resolveRepoName(state, task);
  return (
    <CommandItem
      value={value}
      keywords={listTaskKeywords(state, task)}
      icon={resolveTaskMenuIcon(state, task)}
      onSelect={onGo}
    >
      <Truncate className='min-w-0'>{task.title}</Truncate>
      {repo && <CommandHint className='min-w-12 shrink-[4]'>{repo}</CommandHint>}
      {task.handle && <CommandHint className='shrink-0 tabular-nums'>{resolveHandleText(task)}</CommandHint>}
      <Status>{status.label}</Status>
    </CommandItem>
  );
}

interface BlockActions {
  perform: (command: MenuCommand) => void;
  pick: (command: ChoiceCommand, value: string) => void;
  goTask: (task: Task) => void;
  jump: () => void;
  createTask: () => void;
  draftTask: () => void;
}

function CommandRows({
  commands,
  state,
  onSelect,
}: {
  commands: MenuCommand[];
  state: ShinsaState;
  onSelect: (command: MenuCommand) => void;
}) {
  return commands.map((command) => (
    <CommandRow key={command.id} command={command} state={state} onSelect={onSelect} />
  ));
}

function TasksGroup({
  block,
  state,
  actions,
}: {
  block: Extract<MenuBlock, { kind: 'tasks' }>;
  state: ShinsaState;
  actions: BlockActions;
}) {
  return (
    <CommandGroup value='tasks' heading='Tasks'>
      <CommandRow command={NEW_TASK_COMMAND} state={state} onSelect={actions.perform} />
      <CommandItem
        value={JUMP_VALUE}
        keywords={JUMP_KEYWORDS}
        icon='IconMagnifyingGlass'
        onSelect={actions.jump}
      >
        Jump to a task
        <CommandHint>{block.total}</CommandHint>
        <Icon name='IconChevronRightMedium' className='ms-auto' />
      </CommandItem>
      {block.tasks.map((task) => (
        <TaskRow
          key={task.id}
          state={state}
          task={task}
          value={`task:${task.id}`}
          onGo={() => actions.goTask(task)}
        />
      ))}
    </CommandGroup>
  );
}

function SearchGroup({
  commands,
  query,
  onSelect,
}: {
  commands: MenuCommand[];
  query: string;
  onSelect: (command: MenuCommand) => void;
}) {
  return (
    <CommandGroup value='search' heading='Search'>
      {commands.map((command) => (
        <CommandItem
          key={command.id}
          value={`${FALLBACK_PREFIX}${command.id}`}
          icon={command.icon}
          onSelect={() => onSelect(command)}
        >
          <span className='shrink-0'>{command.label} for</span>
          <Truncate className='min-w-0 text-fg-4'>{`“${query}”`}</Truncate>
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

function NewTaskGroup({ query, actions }: { query: string; actions: BlockActions }) {
  return (
    <CommandGroup value='new-task' heading='New task'>
      <CommandItem value={`${FALLBACK_PREFIX}create`} icon='IconPlusMedium' onSelect={actions.createTask}>
        <span className='shrink-0'>Create task:</span>
        <Truncate className='min-w-0 text-fg-4'>{query}</Truncate>
      </CommandItem>
      <CommandItem value={`${FALLBACK_PREFIX}draft`} icon='IconPencil' onSelect={actions.draftTask}>
        Edit it before starting
      </CommandItem>
    </CommandGroup>
  );
}

function MenuBlockGroup({
  block,
  state,
  query,
  actions,
}: {
  block: MenuBlock;
  state: ShinsaState;
  query: string;
  actions: BlockActions;
}) {
  switch (block.kind) {
    case 'section':
      return (
        <CommandGroup value={block.section.id} heading={block.section.heading}>
          <CommandRows commands={block.commands} state={state} onSelect={actions.perform} />
        </CommandGroup>
      );
    case 'recent':
      return (
        <CommandGroup value='recent' heading='Recent'>
          {block.tasks.map((task) => (
            <TaskRow
              key={task.id}
              state={state}
              task={task}
              value={`recent:${task.id}`}
              onGo={() => actions.goTask(task)}
            />
          ))}
        </CommandGroup>
      );
    case 'decisions':
      return (
        <CommandGroup value='decisions' heading='Decisions'>
          <CommandRows commands={block.commands} state={state} onSelect={actions.perform} />
        </CommandGroup>
      );
    case 'tasks':
      return <TasksGroup block={block} state={state} actions={actions} />;
    case 'choice':
      return (
        <CommandGroup value={block.command.id} heading={block.command.heading}>
          <ChoiceRows command={block.command} flat onPick={actions.pick} />
        </CommandGroup>
      );
    case 'search':
      return <SearchGroup commands={block.commands} query={query} onSelect={actions.perform} />;
    case 'new-task':
      return <NewTaskGroup query={query} actions={actions} />;
  }
}

function ComposeGroup({
  frame,
  typing,
  onSend,
}: {
  frame: Extract<Frame, { kind: 'compose' }>;
  typing: boolean;
  onSend: () => void;
}) {
  return (
    <CommandGroup value='compose' heading={frame.crumb}>
      <CommandItem value={COMPOSE_VALUE} icon='IconSend' disabled={!typing} onSelect={onSend}>
        {frame.submit}
        {!typing && <CommandHint>Type it above first</CommandHint>}
      </CommandItem>
    </CommandGroup>
  );
}

function JumpGroup({
  state,
  tasks,
  onOpen,
}: {
  state: ShinsaState;
  tasks: Task[];
  onOpen: (task: Task) => void;
}) {
  return (
    <CommandGroup value='tasks' heading='Tasks'>
      {tasks.map((task) => (
        <CommandItem
          key={task.id}
          value={`jump:${task.id}`}
          keywords={[task.title, task.handle ?? '', resolveRepoName(state, task), task.branch ?? '']}
          icon={resolveTaskMenuIcon(state, task)}
          onSelect={() => onOpen(task)}
        >
          <Truncate className='min-w-0'>{task.title}</Truncate>
          <CommandHint className='min-w-12 shrink-[4]'>{resolveRepoName(state, task)}</CommandHint>
          {task.handle && (
            <CommandHint className='shrink-0 tabular-nums'>{resolveHandleText(task)}</CommandHint>
          )}
          <Icon name='IconChevronRightMedium' className='ms-auto' />
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

const SELECTED_PREFETCH_MS = 40;

function usePrefetchSelected(state: ShinsaState | null, selected: string) {
  const latest = React.useRef(state);
  latest.current = state;
  const taskId = resolveSelectedTask(selected);
  React.useEffect(() => {
    if (!taskId) return;
    const timer = setTimeout(() => {
      if (latest.current) prefetchTask(latest.current, taskId);
    }, SELECTED_PREFETCH_MS);
    return () => clearTimeout(timer);
  }, [taskId]);
}

export function CommandMenu() {
  const { state } = useConnection();
  const open = useCommandMenuOpen();
  const route = useRoute();
  const registered = useRegisteredSections();
  const theme = useThemePreference();
  const layout = useLayoutPreference();
  const accounts = useAccounts();
  const extensions = useExtensions(open);
  const versions = useVersions(open);
  const [query, setQuery] = React.useState('');
  const [stack, setStack] = React.useState<Visit[]>([]);
  const [selected, setSelected] = React.useState('');
  const [recent, setRecent] = React.useState<string[]>([]);
  usePrefetchSelected(state, selected);
  const restoreFocus = React.useRef(true);
  const openedFrom = React.useRef<HTMLElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const frame = stack.at(-1)?.frame;
  const trimmed = query.trim();
  const typing = trimmed !== '';
  const currentTaskId = useRouteTaskId(state);

  useCommandHotkey();

  React.useEffect(() => {
    if (currentTaskId) recordRecentTask(currentTaskId);
  }, [currentTaskId]);

  React.useEffect(() => {
    if (!open) return;
    restoreFocus.current = true;
    openedFrom.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setRecent(listRecentTaskIds());
  }, [open]);

  React.useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open, stack.length]);

  if (!state) return null;

  const close = () => writeCommandMenuOpen(false);

  const finalFocus = () => {
    if (!restoreFocus.current) return false;
    const origin = openedFrom.current;
    return origin?.isConnected && origin !== document.body ? origin : false;
  };

  const highlight = (value: string) => {
    setSelected(value);
    requestAnimationFrame(() => setSelected(value));
  };

  const enter = (next: Frame, from: string) => {
    setStack((current) => [...current, { frame: next, from }]);
    setQuery(next.kind === 'compose' ? (next.prefill ?? '') : '');
    highlight(resolveFirstValue(next, listMenuTasks(state)));
  };

  const back = () => {
    const origin = stack.at(-1)?.from ?? '';
    setStack((current) => current.slice(0, -1));
    setQuery('');
    highlight(origin);
  };

  const later = (action: () => void) => {
    restoreFocus.current = false;
    close();
    setTimeout(action, 0);
  };

  const perform = (command: MenuCommand) => {
    switch (command.kind) {
      case 'run':
        later(command.run);
        return;
      case 'go':
        close();
        navigate(command.to);
        return;
      case 'link':
        close();
        window.open(command.href, '_blank', 'noopener');
        return;
      case 'page':
        enter(command.page, command.id);
        return;
      case 'choice':
        enter({ kind: 'choice', command }, command.id);
        return;
      case 'search': {
        const text = trimmed;
        later(() => command.search(text));
        return;
      }
    }
  };

  const pick = (command: ChoiceCommand, value: string) => later(() => command.pick(value));

  const goTask = (task: Task) => {
    close();
    navigate(resolveTaskPath(task));
  };

  const createTask = () => {
    const request = trimmed;
    later(
      () =>
        void sendCommandWithToast({ type: 'task.create', request, repoId: null }, describeNewTask(false).done)
    );
  };

  const draftTask = () => {
    const request = trimmed;
    later(() => requestNewTaskOnHome(request));
  };

  const sections = [
    ...registered,
    ...listGlobalSections(state, route, theme, layout),
    ...listAccountSections(accounts),
    ...listScheduleSections(state),
    ...listExtensionSections(extensions.snapshot),
    ...listVersionSections(versions.snapshot, versions.updating),
  ].sort((a, b) => a.rank - b.rank);
  const allTasks = listMenuTasks(state);

  const renderBlock = (block: MenuBlock) => (
    <MenuBlockGroup
      key={block.key}
      block={block}
      state={state}
      query={trimmed}
      actions={{ perform, pick, goTask, jump: () => enter(TASKS_FRAME, JUMP_VALUE), createTask, draftTask }}
    />
  );

  const page = (() => {
    if (!frame) {
      const blocks = listRootBlocks({
        state,
        sections,
        registered,
        recent,
        currentTaskId,
        query: trimmed,
        now: Date.now(),
      });
      return blocks.map(renderBlock);
    }
    if (frame.kind === 'choice') {
      return (
        <CommandGroup value='choice' heading={frame.command.heading}>
          <ChoiceRows command={frame.command} flat={false} onPick={pick} />
        </CommandGroup>
      );
    }
    if (frame.kind === 'compose') {
      return (
        <ComposeGroup
          frame={frame}
          typing={typing}
          onSend={() => {
            const text = trimmed;
            later(() => void frame.send(text));
          }}
        />
      );
    }
    if (frame.kind === 'tasks') {
      return (
        <JumpGroup
          state={state}
          tasks={allTasks}
          onOpen={(task) => enter(resolveTaskPage(state, task, accounts), `jump:${task.id}`)}
        />
      );
    }
    const pageSections = [...frame.sections].sort((a, b) => a.rank - b.rank);
    return arrangeByScore(listSectionBlocks(pageSections, trimmed), typing).map(renderBlock);
  })();

  return (
    <CommandDialog
      open={open}
      onOpenChange={writeCommandMenuOpen}
      onOpenChangeComplete={(next) => {
        if (next) return;
        setQuery('');
        setStack([]);
        setSelected('');
      }}
      finalFocus={finalFocus}
      title='Command menu'
      description='Act on the task in front of you, jump anywhere, or start a new task.'
    >
      <Command
        loop={false}
        value={selected}
        onValueChange={setSelected}
        filter={scoreCommand}
        shouldFilter={frame?.kind !== 'compose'}
      >
        <CommandInput
          ref={inputRef}
          value={query}
          onValueChange={(value) => {
            setQuery(value);
            if (frame?.kind !== 'compose') setSelected('');
          }}
          placeholder={resolvePlaceholder(frame, route)}
          start={frame && <Crumb>{resolveCrumb(frame)}</Crumb>}
          end={<Kbd>esc</Kbd>}
          onKeyDown={(event) => {
            if (event.key !== 'Backspace' || query !== '' || !frame) return;
            event.preventDefault();
            back();
          }}
        />
        <CommandList page={['root', ...stack.map((visit) => visit.from)].join('>')}>{page}</CommandList>
      </Command>
    </CommandDialog>
  );
}

export function CommandMenuButton({ className }: { className?: string }) {
  const key = useCommandKey();
  return (
    <Hint label='Search and actions' shortcut={`${key}K`}>
      <Button
        variant='secondary'
        size='icon-sm'
        icon='IconMagnifyingGlass'
        aria-label='Search and actions'
        onClick={() => writeCommandMenuOpen(true)}
        className={className}
      />
    </Hint>
  );
}
