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
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { MatchedLabel } from '@/components/command/highlight.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { SelectedMark } from '@/components/status/check-mark.tsx';
import { ProjectDotIcon } from '@/components/status/project-dot.tsx';
import { DepthMark, resolveDepthIndent } from '@/components/tasks/row.tsx';
import { useAppShortcuts } from '@/hooks/use-app-shortcuts.ts';
import { useCommandHotkey, useCommandKey } from '@/hooks/use-command-key.ts';
import { useDelay } from '@/hooks/use-delay.ts';
import { useChangelogAvailable } from '@/lib/changelog.ts';
import { isMacPlatform } from '@/lib/code/keys.ts';
import { listAccountSections } from '@/lib/command/accounts.ts';
import { listExtensionSections } from '@/lib/command/extensions.ts';
import { listGlobalSections } from '@/lib/command/global.ts';
import { resolveOpeningStack, trackHoveredTasks } from '@/lib/command/hover.ts';
import { listInitiativeSections } from '@/lib/command/initiatives.ts';
import {
  arrangeByScore,
  type ChoiceCommand,
  COMPOSE_VALUE,
  FALLBACK_PREFIX,
  type Frame,
  JUMP_VALUE,
  listChoiceMatches,
  listDecisionCommands,
  listJumpEntries,
  listMenuTasks,
  listRootBlocks,
  listSectionBlocks,
  type MenuBlock,
  NEW_TASK_COMMAND,
  requestNewTaskOnHome,
  resolveCrumb,
  resolveFirstValue,
  resolvePlaceholder,
  resolveRepoName,
  type TaskAction,
  type TaskEntry,
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
import { listServiceSections } from '@/lib/command/services.ts';
import { type AppShortcutTarget, describeShortcut } from '@/lib/command/shortcuts.ts';
import { resolveTaskPage } from '@/lib/command/task.ts';
import { listVersionSections } from '@/lib/command/versions.ts';
import { useAccounts } from '@/lib/connection/accounts.ts';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { useExtensions } from '@/lib/connection/extensions.ts';
import { useShinsaState } from '@/lib/connection/selectors.ts';
import { useEngineCommands, useRemoteSnapshot, useTeamFeed } from '@/lib/connection/socket.ts';
import { useTerminals } from '@/lib/connection/terminals.ts';
import { useVersions } from '@/lib/connection/versions.ts';
import { listFocusTeams } from '@/lib/focus.ts';
import { describeNewTask } from '@/lib/new-task.ts';
import { useLayoutPreference } from '@/lib/preferences/layout.ts';
import { listRecentTaskIds, recordRecentTask } from '@/lib/preferences/recent-tasks.ts';
import { useThemePreference } from '@/lib/preferences/theme.ts';
import { scheduleAfter } from '@/lib/runtime/timers.ts';
import { resolveSelectedTask } from '@/lib/tasks/prefetch.ts';
import { resolveHandleText } from '@/lib/tasks/rounds.ts';
import { resolveTaskMenuIcon, resolveTaskStatus } from '@/lib/tasks/status.ts';
import { navigate, resolveTaskPath, useRoute, useRouteTaskId } from '@/router.ts';
import { prefetchTask } from '@/routes/task/prefetch.tsx';

function Crumb({ children }: { children: string }) {
  return (
    <span className='-ms-1 inline-flex h-5.5 max-w-48 min-w-0 shrink-0 items-center rounded-control-sm bg-bg-2 px-1 text-xs font-medium text-fg-3'>
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

function ShortcutKeys({ target }: { target: AppShortcutTarget }) {
  const mac = React.useMemo(() => isMacPlatform(navigator.platform), []);
  return <Status>{describeShortcut(target, mac)}</Status>;
}

function CommandRow({
  command,
  state,
  query,
  onSelect,
}: {
  command: MenuCommand;
  state: ShinsaState;
  query: string;
  onSelect: (command: MenuCommand) => void;
}) {
  const task = command.taskId ? state.tasks[command.taskId] : undefined;
  const hint = command.disabled ?? command.hint;
  return (
    <CommandItem
      value={command.id}
      icon={task ? resolveTaskMenuIcon(state, task) : command.icon}
      disabled={isDisabled(command)}
      onSelect={() => onSelect(command)}
      variant={command.destructive ? 'destructive' : 'default'}
    >
      <MatchedLabel text={command.label} query={query} />
      {hint && <CommandHint className='min-w-12 shrink-[4]'>{hint}</CommandHint>}
      {command.trailing && <Status>{command.trailing}</Status>}
      {command.shortcut && !command.current && <ShortcutKeys target={command.shortcut} />}
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
  options,
  flat,
  query,
  onPick,
}: {
  command: ChoiceCommand;
  options: ChoiceOption[];
  flat: boolean;
  query: string;
  onPick: (command: ChoiceCommand, value: string) => void;
}) {
  return options.map((option) => (
    <CommandItem
      key={option.value}
      value={`${command.id}:${option.value}`}
      icon={option.icon}
      disabled={isDisabled(option)}
      onSelect={() => onPick(command, option.value)}
    >
      <OptionDot option={option} />
      {!flat && (option.depth ?? 0) > 0 && (
        <span className={cn('flex shrink-0', resolveDepthIndent(option.depth ?? 0))}>
          <Icon name='IconArrowCornerDownRight' className='text-fg-2' />
        </span>
      )}
      {!flat && <DepthMark depth={option.depth ?? 0} />}
      <MatchedLabel text={option.label} query={query} />
      {!option.disabled && option.hint && (
        <CommandHint className='shrink-0 tabular-nums'>{option.hint}</CommandHint>
      )}
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
  query,
  onGo,
}: {
  state: ShinsaState;
  task: Task;
  value: string;
  query: string;
  onGo: () => void;
}) {
  const status = resolveTaskStatus(state, task);
  const repo = resolveRepoName(state, task);
  return (
    <CommandItem value={value} icon={resolveTaskMenuIcon(state, task)} onSelect={onGo}>
      <MatchedLabel text={task.title} query={query} />
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
  query,
  onSelect,
}: {
  commands: MenuCommand[];
  state: ShinsaState;
  query: string;
  onSelect: (command: MenuCommand) => void;
}) {
  return commands.map((command) => (
    <CommandRow key={command.id} command={command} state={state} query={query} onSelect={onSelect} />
  ));
}

function TaskActionRow({
  action,
  block,
  state,
  query,
  actions,
}: {
  action: TaskAction;
  block: Extract<MenuBlock, { kind: 'tasks' }>;
  state: ShinsaState;
  query: string;
  actions: BlockActions;
}) {
  if (action === 'new')
    return <CommandRow command={NEW_TASK_COMMAND} state={state} query={query} onSelect={actions.perform} />;
  return (
    <CommandItem value={JUMP_VALUE} icon='IconMagnifyingGlass' onSelect={actions.jump}>
      <MatchedLabel text='Jump to a task' query={query} />
      <CommandHint>{block.total}</CommandHint>
      <Icon name='IconChevronRightMedium' className='ms-auto' />
    </CommandItem>
  );
}

function TasksGroup({
  block,
  state,
  query,
  actions,
}: {
  block: Extract<MenuBlock, { kind: 'tasks' }>;
  state: ShinsaState;
  query: string;
  actions: BlockActions;
}) {
  const actionRows = block.actions.map((action) => (
    <TaskActionRow key={action} action={action} block={block} state={state} query={query} actions={actions} />
  ));
  const taskRows = block.tasks.map((task) => (
    <TaskRow
      key={task.id}
      state={state}
      task={task}
      value={`task:${task.id}`}
      query={query}
      onGo={() => actions.goTask(task)}
    />
  ));
  if (actionRows.length === 0 && taskRows.length === 0) return null;
  return (
    <CommandGroup value='tasks' heading='Tasks'>
      {block.actionsFirst ? [...actionRows, ...taskRows] : [...taskRows, ...actionRows]}
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
          <CommandRows commands={block.commands} state={state} query={query} onSelect={actions.perform} />
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
              query={query}
              onGo={() => actions.goTask(task)}
            />
          ))}
        </CommandGroup>
      );
    case 'decisions':
      return (
        <CommandGroup value='decisions' heading='Decisions'>
          <CommandRows commands={block.commands} state={state} query={query} onSelect={actions.perform} />
        </CommandGroup>
      );
    case 'tasks':
      return <TasksGroup block={block} state={state} query={query} actions={actions} />;
    case 'choice':
      return (
        <CommandGroup value={block.command.id} heading={block.command.heading}>
          <ChoiceRows
            command={block.command}
            options={block.options}
            flat
            query={query}
            onPick={actions.pick}
          />
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
  entries,
  query,
  onOpen,
}: {
  state: ShinsaState;
  entries: TaskEntry[];
  query: string;
  onOpen: (task: Task) => void;
}) {
  return (
    <CommandGroup value='tasks' heading='Tasks'>
      {entries.map(({ task }) => (
        <CommandItem
          key={task.id}
          value={`jump:${task.id}`}
          icon={resolveTaskMenuIcon(state, task)}
          onSelect={() => onOpen(task)}
        >
          <MatchedLabel text={task.title} query={query} />
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
  const taskId = resolveSelectedTask(selected);
  useDelay(
    () => {
      if (state && taskId) prefetchTask(state, taskId);
    },
    taskId ? SELECTED_PREFETCH_MS : null,
    [taskId]
  );
}

interface MenuFocus {
  restore: boolean;
}

function CommandMenuContent({ open, focus }: { open: boolean; focus: React.RefObject<MenuFocus> }) {
  const state = useShinsaState();
  const route = useRoute();
  const remote = useRemoteSnapshot();
  const teamFeed = useTeamFeed();
  const focusTeams = React.useMemo(() => listFocusTeams(remote), [remote]);
  const registered = useRegisteredSections();
  const registeredIds = registered
    .flatMap((section) => section.commands.map((command) => command.id))
    .join('\n');
  const theme = useThemePreference();
  const layout = useLayoutPreference();
  const engineCommands = useEngineCommands();
  const accounts = useAccounts();
  const extensions = useExtensions(open);
  const versions = useVersions(open);
  const changelogAvailable = useChangelogAvailable();
  const terminals = useTerminals();
  const [query, setQuery] = React.useState('');
  const [stack, setStack] = React.useState<Visit[]>(() =>
    state ? resolveOpeningStack(state, route, accounts) : []
  );
  const [selected, setSelected] = React.useState('');
  const [recent] = React.useState(listRecentTaskIds);
  usePrefetchSelected(state, selected);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const frame = stack.at(-1)?.frame;
  const trimmed = query.trim();
  const typing = trimmed !== '';
  const currentTaskId = useRouteTaskId(state);

  React.useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open, stack.length]);

  const shared = React.useMemo(
    () =>
      state
        ? [
            ...listGlobalSections(state, route, theme, layout, engineCommands, focusTeams),
            ...listInitiativeSections(state, route, { feed: teamFeed, teams: focusTeams }),
            ...listAccountSections(accounts),
            ...listScheduleSections(state),
            ...listServiceSections(state, terminals, Date.now()),
            ...listExtensionSections(extensions.snapshot),
            ...listVersionSections(versions.snapshot, versions.updating, changelogAvailable),
          ]
        : [],
    [
      state,
      route,
      theme,
      layout,
      engineCommands,
      focusTeams,
      teamFeed,
      accounts,
      terminals,
      extensions.snapshot,
      versions.snapshot,
      versions.updating,
      changelogAvailable,
    ]
  );
  const decisions = React.useMemo(
    () => (state && typing ? listDecisionCommands(state, currentTaskId, registered) : []),
    [state, typing, currentTaskId, registeredIds]
  );
  const sections = [...registered, ...shared].sort((a, b) => a.rank - b.rank);

  if (!state) return null;

  const close = () => writeCommandMenuOpen(false);

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
    focus.current.restore = false;
    close();
    scheduleAfter(0, action);
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
        void sendCommandWithToast(
          { type: 'task.create', request, repoId: null },
          describeNewTask('auto').done
        )
    );
  };

  const draftTask = () => {
    const request = trimmed;
    later(() => requestNewTaskOnHome(request));
  };

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
        decisions,
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
          <ChoiceRows
            command={frame.command}
            options={listChoiceMatches(frame.command, trimmed).options}
            flat={false}
            query={trimmed}
            onPick={pick}
          />
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
          entries={listJumpEntries(state, trimmed)}
          query={trimmed}
          onOpen={(task) => enter(resolveTaskPage(state, task, accounts), `jump:${task.id}`)}
        />
      );
    }
    const pageSections = [...frame.sections].sort((a, b) => a.rank - b.rank);
    return arrangeByScore(listSectionBlocks(pageSections, trimmed), typing).map(renderBlock);
  })();

  return (
    <Command loop={false} value={selected} onValueChange={setSelected} filter={() => 1} shouldFilter={false}>
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
  );
}

export function CommandMenu() {
  const state = useShinsaState();
  const open = useCommandMenuOpen();
  const focus = React.useRef<MenuFocus>({ restore: true });
  const openedFrom = React.useRef<HTMLElement | null>(null);
  const currentTaskId = useRouteTaskId(state);

  useCommandHotkey();
  useAppShortcuts();

  const openRef = React.useRef(open);
  openRef.current = open;
  React.useEffect(() => trackHoveredTasks(() => openRef.current), []);

  React.useEffect(() => {
    if (currentTaskId) recordRecentTask(currentTaskId);
  }, [currentTaskId]);

  React.useLayoutEffect(() => {
    if (!open) return;
    focus.current.restore = true;
    openedFrom.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [open]);

  if (!state) return null;

  const finalFocus = () => {
    if (!focus.current.restore) return false;
    const origin = openedFrom.current;
    return origin?.isConnected && origin !== document.body ? origin : false;
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={writeCommandMenuOpen}
      finalFocus={finalFocus}
      title='Command menu'
      description='Act on the task in front of you, jump anywhere, or start a new task.'
    >
      <CommandMenuContent open={open} focus={focus} />
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
