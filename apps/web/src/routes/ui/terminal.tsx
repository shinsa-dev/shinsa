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
import * as React from 'react';
import { ProjectMenuTrigger } from '@/components/focus/menu.tsx';
import { NAV_ITEM } from '@/components/layout/nav-item.tsx';
import { Toolbar } from '@/components/layout/page/toolbar.tsx';
import { ServicesPanel, ServicesTriggerLabel } from '@/components/services/menu.tsx';
import { ServicePicker } from '@/components/services/service-dialog.tsx';
import { type ServiceHandlers, ServiceRow } from '@/components/services/service-row.tsx';
import { EndedBar } from '@/components/terminal/ended-bar.tsx';
import { NewTerminalButton } from '@/components/terminal/place-menu.tsx';
import { TerminalTabs } from '@/components/terminal/tab-bar.tsx';
import { listRecommendedPicks, togglePick } from '@/lib/terminal/services.ts';
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
  status: 'running',
  exitCode: null,
  startedAt: 0,
  endedAt: null,
};

function service(name: string, command = 'bun run dev'): ServiceDefinition {
  return { id: name, projectId: 'shop', name, cwd: `~/Developer/shop/apps/${name}`, command, env: {} };
}

function serviceTerminal(name: string, extra: Partial<TerminalInfo>): TerminalInfo {
  return { ...BASE, id: `t-${name}`, name, title: null, serviceId: name, ...extra };
}

const RUNNING = serviceTerminal('api', { startedAt: NOW - 3_720_000 });

const FAILED = serviceTerminal('worker', { status: 'exited', exitCode: 1, endedAt: NOW - 60_000 });

const VIEWS: ServiceView[] = [
  resolveServiceView(service('api'), RUNNING, NOW),
  resolveServiceView(service('web'), serviceTerminal('web', { startedAt: NOW - 1000 }), NOW),
  resolveServiceView(service('worker', 'bun run worker'), FAILED, NOW),
  resolveServiceView(
    service('docs'),
    serviceTerminal('docs', { status: 'exited', exitCode: 0, endedAt: NOW - 5000 }),
    NOW
  ),
  resolveServiceView(service('storybook', 'bun run storybook'), null, NOW),
];

const TERMINALS: TerminalInfo[] = [
  RUNNING,
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

function ServicePickerSample() {
  const [picked, setPicked] = React.useState(() => listRecommendedPicks(SUGGESTIONS));
  return (
    <ServicePicker
      suggestions={SUGGESTIONS}
      places={SHOP_PLACES}
      picked={picked}
      onToggle={(key) => setPicked((current) => togglePick(current, key))}
    />
  );
}

const HANDLERS: ServiceHandlers = {
  start: acknowledgeSample,
  stop: acknowledgeSample,
  restart: acknowledgeSample,
  open: acknowledgeSample,
  edit: acknowledgeSample,
  remove: acknowledgeSample,
};

const GROUPS: PlaceGroup[] = [
  {
    kind: 'repository',
    heading: 'Repositories',
    places: [
      { path: '~/Developer/shop', label: 'shop', kind: 'repository', taskId: null },
      { path: '~/Developer/shop-api', label: 'shop-api', kind: 'repository', taskId: null },
    ],
  },
  {
    kind: 'worktree',
    heading: 'Task worktrees',
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
      className='flex w-full flex-col gap-1 rounded-lg p-3 font-mono text-xs'
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
      <Specimen label='ServiceRow · running, starting, failed, exited and never started'>
        <div className='flex w-96 flex-col gap-px rounded-lg border border-border p-1'>
          {VIEWS.map((view) => (
            <ServiceRow key={view.service.id} view={view} project={PROJECT} now={NOW} handlers={HANDLERS} />
          ))}
        </div>
      </Specimen>
      <Specimen label='The Services popover · a project’s services and its footer'>
        <div className='flex w-96 flex-col overflow-hidden rounded-lg border border-border bg-popover'>
          <ServicesPanel
            groups={[{ project: PROJECT, views: VIEWS.slice(0, 3) }]}
            now={NOW}
            handlers={HANDLERS}
            footer={
              <>
                <Button variant='secondary' size='sm' icon='IconPlusMedium' onClick={acknowledgeSample}>
                  Add services…
                </Button>
                <span className='flex-1' />
                <Button variant='secondary' size='sm' icon='IconConsole' onClick={acknowledgeSample}>
                  Terminal
                </Button>
              </>
            }
          />
        </div>
      </Specimen>
      <Specimen label='The Services popover · a project with none yet'>
        <div className='flex w-96 flex-col overflow-hidden rounded-lg border border-border bg-popover'>
          <ServicesPanel
            groups={[{ project: PROJECT, views: [] }]}
            now={NOW}
            handlers={HANDLERS}
            footer={
              <Button variant='secondary' size='sm' icon='IconPlusMedium' onClick={acknowledgeSample}>
                Add services…
              </Button>
            }
          />
        </div>
      </Specimen>
      <Specimen label='Add services · what Shinsa found, the recommended ones ticked'>
        <div className='w-105'>
          <ServicePickerSample />
        </div>
      </Specimen>
      <Specimen label='The Terminal page’s project picker, the Focus menu’s trigger'>
        <DropdownMenu>
          <ProjectMenuTrigger color='green' value='Shop' compact />
        </DropdownMenu>
      </Specimen>
      <Specimen label='TerminalTabs · two services, a named tab, the shell’s title, an exited shell, one the engine restart ended'>
        <Toolbar className='w-full gap-1.5 ps-2'>
          <TerminalTabs
            terminals={TERMINALS}
            services={VIEWS}
            now={NOW}
            activeId='t-api'
            renamingId={null}
            onSelect={acknowledgeSample}
            onClose={acknowledgeSample}
            onRenameStart={acknowledgeSample}
            onRename={acknowledgeSample}
            onReorder={acknowledgeSample}
          />
          <NewTerminalButton groups={GROUPS} fallback={null} onOpen={acknowledgeSample} />
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
