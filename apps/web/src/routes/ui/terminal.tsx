import {
  type Project,
  resolveServiceView,
  type ServiceDefinition,
  type ServiceSuggestion,
  type ServiceView,
  type TerminalInfo,
  type TerminalPlace,
} from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { DropdownMenu } from '@shinsa/ui/components/dropdown-menu';
import { EmptyState } from '@shinsa/ui/components/empty-state';
import { HoverHighlight } from '@shinsa/ui/components/highlight-list';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { ProjectMenuTrigger } from '@/components/focus/menu.tsx';
import { NAV_ITEM } from '@/components/layout/nav-item.tsx';
import { Toolbar } from '@/components/layout/page/toolbar.tsx';
import { INSET } from '@/components/layout/surface/card.ts';
import { SERVICES_PANEL, ServicesPanel, ServicesTriggerLabel } from '@/components/services/menu.tsx';
import type { ServicesPanelActions } from '@/components/services/panel-views.tsx';
import { type ServiceHandlers, ServiceRow, ServiceRunButtons } from '@/components/services/service-row.tsx';
import { TaskServicesPanel } from '@/components/services/task-menu.tsx';
import { EndedBar } from '@/components/terminal/ended-bar.tsx';
import { NewTerminalButton } from '@/components/terminal/place-menu.tsx';
import { TerminalTabs } from '@/components/terminal/tab-bar.tsx';
import { resolveProjectMark } from '@/lib/projects.ts';
import type { ServiceGroup, TaskServiceRun } from '@/lib/terminal/services.ts';
import {
  createServicesPanel,
  reduceServicesPanel,
  type ServicesPanelAction,
  type ServicesPanelState,
} from '@/lib/terminal/services-panel.ts';
import type { PlaceGroup } from '@/lib/terminal/tabs.ts';
import { readDocumentVariable, resolveTerminalTheme } from '@/lib/terminal/theme.ts';
import { acknowledgeSample } from './samples.ts';
import { Specimen } from './section.tsx';

const NOW = 1_800_000_000_000;

const PROJECT: Project = {
  id: 'shop',
  name: 'Shop',
  key: 'SHOP',
  color: 'green',
  description: '',
  folders: [],
} as unknown as Project;

const BASE: TerminalInfo = {
  id: 'server',
  projectId: 'shop',
  name: 'Dev server',
  title: 'bun dev',
  cwd: '~/Developer/shop',
  place: 'repository',
  taskId: null,
  serviceId: null,
  port: null,
  status: 'running',
  exitCode: null,
  startedAt: 0,
  endedAt: null,
};

function service(name: string, command = 'bun run dev', previewUrl: string | null = null): ServiceDefinition {
  return {
    id: name,
    projectId: 'shop',
    name,
    cwd: `~/Developer/shop/apps/${name}`,
    command,
    env: {},
    previewUrl,
    portVariable: 'PORT',
  };
}

function serviceTerminal(name: string, extra: Partial<TerminalInfo>): TerminalInfo {
  return { ...BASE, id: `t-${name}`, name, title: null, serviceId: name, ...extra };
}

const API = service('api', 'bun run dev', 'http://localhost:{port}/cart');

const RUNNING = serviceTerminal('api', { startedAt: NOW - 3_720_000, port: 4000 });

const FAILED = serviceTerminal('worker', { status: 'exited', exitCode: 1, endedAt: NOW - 60_000 });

const TASK_RUN = serviceTerminal('api', {
  id: 't-api-sh-4',
  taskId: 'sh-4',
  place: 'worktree',
  cwd: '~/.config/shinsa/data/worktrees/sh-4/apps/api',
  port: 51342,
  startedAt: NOW - 540_000,
});

const TASK_FAILED = serviceTerminal('api', {
  id: 't-api-sh-7',
  taskId: 'sh-7',
  place: 'worktree',
  status: 'exited',
  exitCode: 1,
  endedAt: NOW - 120_000,
});

const TASK_HANDLES = { 'sh-4': { handle: 'SH-4' }, 'sh-7': { handle: 'SH-7' } };

const VIEWS: ServiceView[] = [
  resolveServiceView(API, RUNNING, NOW),
  resolveServiceView(service('web'), serviceTerminal('web', { startedAt: NOW - 1000 }), NOW),
  resolveServiceView(service('worker', 'bun run worker'), FAILED, NOW),
  resolveServiceView(
    service('docs'),
    serviceTerminal('docs', { status: 'exited', exitCode: 0, endedAt: NOW - 5000 }),
    NOW
  ),
  resolveServiceView(service('storybook', 'bun run storybook'), null, NOW),
];

const TASK_VIEWS: ServiceView[] = [
  resolveServiceView(API, TASK_RUN, NOW),
  resolveServiceView(service('web'), null, NOW, 'sh-4'),
];

const TASK_RUNS: TaskServiceRun[] = [
  { view: resolveServiceView(API, TASK_RUN, NOW), label: 'SH-4 Fix the cart' },
  { view: resolveServiceView(API, TASK_FAILED, NOW), label: 'SH-7 Show the order total' },
];

const TERMINALS: TerminalInfo[] = [
  RUNNING,
  TASK_RUN,
  FAILED,
  BASE,
  { ...BASE, id: 'shell', name: null, title: 'fish' },
  { ...BASE, id: 'tests', name: null, title: 'bun test', status: 'exited', exitCode: 1, endedAt: 1 },
  { ...BASE, id: 'old', name: 'Logs', status: 'stopped', endedAt: 1 },
];

const SUGGESTIONS: ServiceSuggestion[] = [
  {
    name: 'api',
    cwd: '~/Developer/shop/apps/api',
    command: 'bun run dev',
    source: 'package',
    recommended: true,
  },
  {
    name: 'web',
    cwd: '~/Developer/shop/apps/web',
    command: 'bun run dev',
    source: 'package',
    recommended: true,
  },
  {
    name: 'db',
    cwd: '~/Developer/shop',
    command: 'docker compose up db',
    source: 'compose',
    recommended: true,
  },
  { name: 'all', cwd: '~/Developer/shop', command: 'bun run dev', source: 'package', recommended: false },
];

const SHOP_PLACES: TerminalPlace[] = [
  { path: '~/Developer/shop', label: 'shop', kind: 'repository', taskId: null },
];

const PANEL_ACTIONS: ServicesPanelActions = {
  home: '~',
  focusForms: false,
  listPlaces: () => SHOP_PLACES,
  listSuggestions: async () => SUGGESTIONS,
  add: async () => true,
  addOne: async () => true,
  update: async () => true,
  remove: async () => true,
};

function PanelSample({
  groups,
  scope = groups.map((group) => group.project),
  start,
}: {
  groups: ServiceGroup[];
  scope?: Project[];
  start: ServicesPanelAction[];
}) {
  const [panel, dispatch] = React.useReducer(
    reduceServicesPanel,
    start,
    (actions): ServicesPanelState => actions.reduce(reduceServicesPanel, createServicesPanel('list', 'shop'))
  );
  return (
    <div className={cn(INSET, SERVICES_PANEL, 'overflow-hidden bg-popover [--available-height:28rem]')}>
      <ServicesPanel
        groups={groups}
        scope={scope}
        now={NOW}
        handlers={HANDLERS}
        actions={PANEL_ACTIONS}
        panel={panel}
        onPanel={dispatch}
        onCreateProject={acknowledgeSample}
        onTerminal={acknowledgeSample}
      />
    </div>
  );
}

const BLOG: Project = { ...PROJECT, id: 'blog', name: 'Blog', key: 'BLOG', color: 'blue' };

const NOTES: Project = { ...PROJECT, id: 'notes', name: 'Notes', key: 'NOTE', color: 'orange' };

const GROUPS_MANY: ServiceGroup[] = [
  { project: BLOG, views: VIEWS.slice(0, 1) },
  { project: NOTES, views: VIEWS.slice(3, 5) },
  { project: PROJECT, views: VIEWS, runs: { api: TASK_RUNS } },
];

const HANDLERS: ServiceHandlers = {
  start: acknowledgeSample,
  stop: acknowledgeSample,
  restart: acknowledgeSample,
  startAll: acknowledgeSample,
  open: acknowledgeSample,
  preview: acknowledgeSample,
};

const GROUPS: PlaceGroup[] = [
  {
    kind: 'repository',
    heading: 'Repositories',
    icon: resolveProjectMark('IconFolder1', PROJECT.color),
    places: [
      { path: '~/Developer/shop', label: 'shop', kind: 'repository', taskId: null },
      { path: '~/Developer/shop-api', label: 'shop-api', kind: 'repository', taskId: null },
    ],
  },
  {
    kind: 'worktree',
    heading: 'Task worktrees',
    icon: 'IconBranch',
    places: [
      {
        path: '~/.config/shinsa/data/worktrees/sh-4',
        label: 'SH-4 Fix the cart',
        kind: 'worktree',
        taskId: 'sh-4',
      },
    ],
  },
];

const TRIGGERS: { label: string; views: ServiceView[] }[] = [
  { label: 'none running', views: [] },
  { label: 'running', views: VIEWS.slice(0, 1) },
  { label: 'starting', views: VIEWS.slice(1, 2) },
  { label: 'failed', views: VIEWS.slice(0, 3) },
];

function Palette() {
  const theme = resolveTerminalTheme(readDocumentVariable);
  const names = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const;
  return (
    <div
      style={{ background: theme.background, color: theme.foreground }}
      className={cn(INSET, 'flex w-full flex-col gap-1 p-3 font-mono text-xs')}
    >
      <span>The --terminal-* tokens, in Shinsa’s mono font</span>
      <span className='flex flex-wrap gap-3'>
        {names.map((name) => (
          <span key={name} style={{ color: theme[name] }}>
            {name}
          </span>
        ))}
      </span>
    </div>
  );
}

export function TerminalSpecimens() {
  const [active, setActive] = React.useState('t-api');
  return (
    <>
      <Specimen label='Services in the top bar · nothing running, running, starting, failed, and on the Terminal page'>
        <div className='flex flex-wrap items-center gap-2'>
          {TRIGGERS.map((trigger) => (
            <Button
              key={trigger.label}
              variant='secondary'
              size='sm'
              icon={{ name: 'IconChevronDownSmall', position: 'inline-end' }}
              className='pl-1.5 text-fg-3'
              onClick={acknowledgeSample}
            >
              <ServicesTriggerLabel views={trigger.views} active={false} variant='bar' />
            </Button>
          ))}
          <Button
            variant='secondary'
            size='sm'
            icon={{ name: 'IconChevronDownSmall', position: 'inline-end' }}
            className='pl-1.5 text-fg-4'
            onClick={acknowledgeSample}
          >
            <ServicesTriggerLabel views={VIEWS.slice(0, 1)} active variant='bar' />
          </Button>
        </div>
      </Specimen>
      <Specimen label='Services in the Shelf rail · and on the Terminal page'>
        <div className='flex w-60 flex-col gap-px'>
          <button type='button' data-active={false} className={NAV_ITEM} onClick={acknowledgeSample}>
            <ServicesTriggerLabel views={VIEWS.slice(0, 3)} active={false} variant='rail' />
          </button>
          <button type='button' data-active className={NAV_ITEM} onClick={acknowledgeSample}>
            <ServicesTriggerLabel views={VIEWS.slice(0, 1)} active variant='rail' />
          </button>
        </div>
      </Specimen>
      <Specimen label='ServiceRow · running, starting, failed, exited and never started (hover a running row for Restart and Stop)'>
        <HoverHighlight className={cn(INSET, 'flex w-88 flex-col gap-px p-1')}>
          {VIEWS.map((view) => (
            <ServiceRow key={view.service.id} view={view} project={PROJECT} now={NOW} handlers={HANDLERS} />
          ))}
        </HoverHighlight>
      </Specimen>
      <Specimen label='The Services popover · three projects, each folding from its header, the play button that starts all where two or more are stopped, and a service’s runs in tasks under it'>
        <PanelSample groups={GROUPS_MANY} start={[]} />
      </Specimen>
      <Specimen label='A task’s Services popover · one running in its worktree, one it has not started'>
        <div className={cn(INSET, SERVICES_PANEL, 'overflow-hidden bg-popover')}>
          <TaskServicesPanel
            task={{ handle: 'SH-4' }}
            views={TASK_VIEWS}
            project={PROJECT}
            now={NOW}
            handlers={HANDLERS}
          />
        </div>
      </Specimen>
      <Specimen label='The Services popover · a project with none yet, and no project at all'>
        <div className='flex flex-wrap items-start gap-3'>
          <PanelSample groups={[{ project: PROJECT, views: [] }]} start={[]} />
          <PanelSample groups={[]} start={[]} />
        </div>
      </Specimen>
      <Specimen label='The Services popover · Manage, two ticked, and asking before it removes them'>
        <div className='flex flex-wrap items-start gap-3'>
          <PanelSample
            groups={GROUPS_MANY}
            start={[
              { type: 'manage', on: true },
              { type: 'pick', picked: VIEWS.slice(3, 5).map((view) => view.service.id) },
            ]}
          />
          <PanelSample
            groups={GROUPS_MANY}
            start={[
              { type: 'manage', on: true },
              { type: 'pick', picked: VIEWS.slice(3, 5).map((view) => view.service.id) },
              { type: 'confirm', on: true },
            ]}
          />
        </div>
      </Specimen>
      <Specimen label='The Services popover · Add services with the project picker, the custom form and editing a service'>
        <div className='flex flex-wrap items-start gap-3'>
          <PanelSample
            groups={GROUPS_MANY}
            scope={[PROJECT, BLOG, NOTES]}
            start={[{ type: 'open', mode: 'add', projectId: 'shop' }]}
          />
          <PanelSample
            groups={GROUPS_MANY}
            start={[{ type: 'open', mode: 'add', projectId: 'shop' }, { type: 'custom' }]}
          />
          <PanelSample
            groups={GROUPS_MANY}
            start={[
              { type: 'manage', on: true },
              { type: 'edit', serviceId: VIEWS[0]?.service.id ?? '' },
            ]}
          />
        </div>
      </Specimen>
      <Specimen label='The Terminal page’s project picker, the Focus menu’s trigger'>
        <DropdownMenu>
          <ProjectMenuTrigger color='green' value='Shop' compact />
        </DropdownMenu>
      </Specimen>
      <Specimen label='TerminalTabs · two services, a named tab, the shell’s title, an exited shell, one the engine restart ended, and the buttons of the service in front with its Open'>
        <Toolbar className='w-full gap-1.5 ps-2'>
          <TerminalTabs
            terminals={TERMINALS}
            tasks={TASK_HANDLES}
            services={[...VIEWS, TASK_VIEWS[0] as ServiceView]}
            now={NOW}
            activeId={active}
            renamingId={null}
            onSelect={(terminal) => setActive(terminal.id)}
            onClose={acknowledgeSample}
            onRenameStart={acknowledgeSample}
            onRename={acknowledgeSample}
            onReorder={acknowledgeSample}
          />
          <NewTerminalButton groups={GROUPS} fallback={null} onOpen={acknowledgeSample} />
          <span className='flex shrink-0 items-center gap-px border-border border-s ps-1.5'>
            <ServiceRunButtons
              view={VIEWS[0] as ServiceView}
              onStart={acknowledgeSample}
              onStop={acknowledgeSample}
              onRestart={acknowledgeSample}
              onPreview={acknowledgeSample}
            />
          </span>
        </Toolbar>
      </Specimen>
      <Specimen label='TerminalTabs · renaming a tab'>
        <Toolbar className='w-full gap-1.5 ps-2'>
          <TerminalTabs
            terminals={TERMINALS.slice(2, 4)}
            services={[]}
            now={NOW}
            activeId='server'
            renamingId='server'
            onSelect={acknowledgeSample}
            onClose={acknowledgeSample}
            onRenameStart={acknowledgeSample}
            onRename={acknowledgeSample}
            onReorder={acknowledgeSample}
          />
        </Toolbar>
      </Specimen>
      <Specimen label='EndedBar · a service that failed, a shell that exited, and one the engine restart ended'>
        <div className='flex w-full flex-col'>
          {[FAILED, TERMINALS[4] ?? BASE, TERMINALS[5] ?? BASE].map((terminal) => (
            <EndedBar
              key={terminal.id}
              terminal={terminal}
              onRestart={acknowledgeSample}
              onClose={acknowledgeSample}
            />
          ))}
        </div>
      </Specimen>
      <Specimen label='The empty project, with the place menu'>
        <EmptyState
          icon='IconConsole'
          title='No terminals in Shop'
          description='A terminal keeps running when you close Shinsa.'
        >
          <NewTerminalButton
            groups={GROUPS}
            fallback={null}
            label='Open a terminal'
            wide
            onOpen={acknowledgeSample}
          />
        </EmptyState>
      </Specimen>
      <Specimen label='Shinsa’s terminal colours in this theme'>
        <Palette />
      </Specimen>
    </>
  );
}
