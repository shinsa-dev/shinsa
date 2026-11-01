import { afterEach, describe, expect, it, mock } from 'bun:test';
import {
  type Project,
  resolveServiceView,
  SERVICE_LIMITS,
  type ServiceSuggestion,
  type ServiceView,
  type TerminalPlace,
} from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as React from 'react';
import { TaskQueue } from '@/components/queue/queue.tsx';
import { ServicesPanel } from '@/components/services/menu.tsx';
import type { ServicesPanelActions } from '@/components/services/panel-views.tsx';
import type { ServiceHandlers } from '@/components/services/service-row.tsx';
import type { ServiceGroup } from '@/lib/terminal/services.ts';
import {
  createServicesPanel,
  reduceServicesPanel,
  type ServicesPanelMode,
} from '@/lib/terminal/services-panel.ts';
import { createGate, createProject, createShinsaState, createTask, NOW } from '../../support/state.ts';
import { createService, createTerminal } from '../../support/terminals.ts';

const LATER = NOW + SERVICE_LIMITS.startingMs + 1;

const SHOP = createProject({ id: 'shop', name: 'Shop', color: 'green' });

const BLOG = createProject({ id: 'blog', name: 'Blog', color: 'blue' });

const QUEUE = createShinsaState({
  tasks: [createTask({ id: 'review', title: 'Review the login fix', stage: 'reviewing' })],
  gates: [createGate({ id: 'g-review', taskId: 'review', type: 'review' })],
});

const NO_PREVIEW = { previewUrl: null, portVariable: 'PORT' };

function running(id: string): ServiceView {
  return resolveServiceView(
    createService({ id }),
    createTerminal({ id: `t-${id}`, serviceId: id, startedAt: NOW }),
    LATER
  );
}

function stopped(id: string): ServiceView {
  return resolveServiceView(createService({ id }), null, LATER);
}

function createHandlers() {
  const calls: string[] = [];
  const record = (name: string) => (view: ServiceView) => calls.push(`${name} ${view.service.name}`);
  const handlers: ServiceHandlers = {
    start: record('start'),
    stop: record('stop'),
    restart: record('restart'),
    startAll: (project) => calls.push(`start all ${project.name}`),
    open: record('open'),
    preview: record('preview'),
  };
  return { calls, handlers };
}

const ROOT = '/code/shop';

const PLACES: TerminalPlace[] = [{ path: ROOT, label: 'shop', kind: 'repository', taskId: null }];

const DETECTED = { previewUrl: null, portVariable: 'PORT' };

const SUGGESTIONS: ServiceSuggestion[] = [
  {
    name: 'api',
    cwd: `${ROOT}/apps/api`,
    command: 'bun run dev',
    source: 'package',
    recommended: true,
    ...DETECTED,
  },
  {
    name: 'web',
    cwd: `${ROOT}/apps/web`,
    command: 'bun run dev',
    source: 'package',
    recommended: true,
    ...DETECTED,
  },
  { name: 'all', cwd: ROOT, command: 'bun run dev', source: 'package', recommended: false, ...DETECTED },
];

function createActions(
  suggestions: ServiceSuggestion[] = SUGGESTIONS,
  refine: () => Promise<ServiceSuggestion[] | null> = async () => null
) {
  const calls: unknown[] = [];
  const answer =
    (name: string) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args]);
      return true;
    };
  const actions: ServicesPanelActions = {
    home: '/home',
    focusForms: true,
    listPlaces: () => PLACES,
    listSuggestions: async () => suggestions,
    refineSuggestions: refine,
    add: answer('add'),
    addOne: answer('addOne'),
    update: answer('update'),
    remove: answer('remove'),
  };
  return { actions, calls };
}

function Harness({
  groups,
  scope,
  actions,
  handlers,
  mode,
  onCreateProject,
}: {
  groups: ServiceGroup[];
  scope: Project[];
  actions: ServicesPanelActions;
  handlers: ServiceHandlers;
  mode: ServicesPanelMode;
  onCreateProject: () => void;
}) {
  const [panel, dispatch] = React.useReducer(reduceServicesPanel, null, () =>
    createServicesPanel(mode, scope[0]?.id ?? null)
  );
  return (
    <ServicesPanel
      groups={groups}
      scope={scope}
      now={LATER}
      handlers={handlers}
      actions={actions}
      panel={panel}
      onPanel={dispatch}
      onCreateProject={onCreateProject}
      onTerminal={() => undefined}
    />
  );
}

function renderPanel(
  groups: ServiceGroup[],
  {
    scope = groups.map((group) => group.project),
    mode = 'list',
    suggestions,
    refine,
  }: {
    scope?: Project[];
    mode?: ServicesPanelMode;
    suggestions?: ServiceSuggestion[];
    refine?: () => Promise<ServiceSuggestion[] | null>;
  } = {}
) {
  const { calls, handlers } = createHandlers();
  const panel = createActions(suggestions, refine);
  const created = mock(() => undefined);
  render(
    <TooltipProvider>
      <Harness
        groups={groups}
        scope={scope}
        actions={panel.actions}
        handlers={handlers}
        mode={mode}
        onCreateProject={created}
      />
    </TooltipProvider>
  );
  return { calls, created, sent: panel.calls };
}

afterEach(() => {
  localStorage.clear();
});

describe('the Services popover', () => {
  it('says what a service is when the project has none and none were found, with Add… in the footer', async () => {
    renderPanel([{ project: SHOP, views: [] }], { suggestions: [] });
    expect(await screen.findByText('No services in Shop yet')).toBeTruthy();
    expect(
      screen.getByText('A service is a command you keep running for a project, like its dev server.')
    ).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Add…' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Manage' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Terminal' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add…' }));
    expect(await screen.findByRole('textbox', { name: 'Name' })).toBeTruthy();
  });

  it('shows what was found when the project has none yet, ticked and ready to add, with no Back', async () => {
    const { sent } = renderPanel([{ project: SHOP, views: [] }]);
    expect(await screen.findByText('No services in Shop yet')).toBeTruthy();
    expect(
      screen.getByText('These were found in its folders. Each runs in a terminal of its own.')
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Add 2 services' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect((sent[0] as unknown[])[0]).toBe('add');
  });

  it('opens the custom form from what was found, and comes back to it', async () => {
    renderPanel([{ project: SHOP, views: [] }]);
    fireEvent.click(await screen.findByRole('button', { name: 'Custom service…' }));
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('button', { name: 'Add 2 services' })).toBeTruthy();
  });

  it('shows what was found at once, then the list checked with AI, ticked as it recommends', async () => {
    let finish: (refined: ServiceSuggestion[] | null) => void = () => undefined;
    const refined = [
      { ...SUGGESTIONS[0], recommended: false },
      { ...SUGGESTIONS[1], command: 'bun run dev --port $PORT', previewUrl: 'http://localhost:{port}' },
      { ...SUGGESTIONS[2], recommended: true },
    ] as ServiceSuggestion[];
    const { sent } = renderPanel([{ project: SHOP, views: [] }], {
      refine: () => new Promise((resolve) => (finish = resolve)),
    });
    expect(await screen.findByRole('button', { name: 'Add 2 services' })).toBeTruthy();
    expect(await screen.findByText('Checking names and ports with AI')).toBeTruthy();
    act(() => finish(refined));
    expect(await screen.findByText('bun run dev --port $PORT')).toBeTruthy();
    expect(screen.queryByText('Checking names and ports with AI')).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Add all' }).getAttribute('aria-checked')).toBe('true')
    );
    expect(screen.getByRole('checkbox', { name: 'Add api' }).getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 services' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect((sent[0] as unknown[])[2]).toEqual([
      {
        name: 'web',
        cwd: `${ROOT}/apps/web`,
        command: 'bun run dev --port $PORT',
        env: {},
        previewUrl: 'http://localhost:{port}',
        portVariable: 'PORT',
      },
      { name: 'all', cwd: ROOT, command: 'bun run dev', env: {}, ...NO_PREVIEW },
    ]);
  });

  it('keeps the ticks you changed when the checked list arrives', async () => {
    let finish: (refined: ServiceSuggestion[] | null) => void = () => undefined;
    renderPanel([{ project: SHOP, views: [] }], {
      refine: () => new Promise((resolve) => (finish = resolve)),
    });
    await screen.findByRole('button', { name: 'Add 2 services' });
    fireEvent.click(screen.getByText('api'));
    act(() => finish(SUGGESTIONS.map((each) => ({ ...each, command: `${each.command} --port $PORT` }))));
    await waitFor(() =>
      expect(screen.getByRole('group', { name: 'Services found' }).textContent).toContain(
        'bun run dev --port $PORT in shop/apps/api'
      )
    );
    expect(screen.getByRole('checkbox', { name: 'Add api' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('checkbox', { name: 'Add web' }).getAttribute('aria-checked')).toBe('true');
  });

  it('keeps the list found when the check with AI fails', async () => {
    renderPanel([{ project: SHOP, views: [] }], { refine: () => Promise.reject(new Error('down')) });
    expect(await screen.findByRole('button', { name: 'Add 2 services' })).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Checking names and ports with AI')).toBeNull());
    expect(screen.getByRole('group', { name: 'Services found' }).textContent).toContain(
      'bun run dev in shop/apps/api'
    );
  });

  it('asks for a project first when there is none to add services to', () => {
    const { created } = renderPanel([], { scope: [] });
    expect(screen.getByText('No services yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add…' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Create a project…' }));
    expect(created).toHaveBeenCalledTimes(1);
  });

  it('groups services by project with what runs, and folds a project away from its header', () => {
    const { calls } = renderPanel([
      { project: BLOG, views: [running('blog')] },
      { project: SHOP, views: [running('api'), stopped('web'), stopped('docs')] },
    ]);
    const shop = screen.getByText('Shop').closest('section') as HTMLElement;
    expect(within(shop).getByText('1 running')).toBeTruthy();
    fireEvent.click(within(shop).getByRole('button', { name: 'Start all services in Shop' }));
    expect(calls).toEqual(['start all Shop']);
    expect(within(shop).getByText('web')).toBeTruthy();
    const blog = screen.getByText('Blog').closest('section') as HTMLElement;
    expect(within(blog).queryByRole('button', { name: /^Start all/ })).toBeNull();
    fireEvent.click(within(blog).getByRole('button', { name: 'Collapse Blog' }));
    expect(within(blog).queryByText('blog')).toBeNull();
    fireEvent.click(within(shop).getByRole('button', { name: 'Collapse Shop' }));
    expect(within(shop).queryByText('web')).toBeNull();
    fireEvent.click(screen.getByText('Shop'));
    expect(within(shop).getByText('web')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add…' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Manage' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: 'Terminal' })).toBeTruthy();
  });

  it('lists a service’s runs in tasks under it, each opening, stopping or starting that task’s run', () => {
    const forTask = resolveServiceView(
      createService({ id: 'api' }),
      createTerminal({ id: 't-fix', serviceId: 'api', taskId: 'fix', startedAt: NOW }),
      LATER
    );
    const failed = resolveServiceView(
      createService({ id: 'api' }),
      createTerminal({
        id: 't-cart',
        serviceId: 'api',
        taskId: 'cart',
        status: 'exited',
        exitCode: 1,
        endedAt: NOW,
      }),
      LATER
    );
    const { calls } = renderPanel([
      {
        project: SHOP,
        views: [stopped('api')],
        runs: {
          api: [
            { view: forTask, label: 'SH-4 Fix the cart' },
            { view: failed, label: 'SH-7 Show the total' },
          ],
        },
      },
    ]);
    expect(screen.getByText('SH-4 Fix the cart')).toBeTruthy();
    expect(screen.getByText('Failed with code 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open the terminal of api for SH-4 Fix the cart' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop api' }));
    const starts = screen.getAllByRole('button', { name: 'Start api' });
    for (const start of starts) fireEvent.click(start);
    expect(calls).toEqual(['open api', 'stop api', 'start api', 'start api']);
    const guide = (label: string) =>
      (screen.getByText(label).closest('[data-highlight-item]') as HTMLElement).querySelector('span');
    expect(guide('SH-4 Fix the cart')?.className).toContain('bottom-0');
    expect(guide('SH-7 Show the total')?.className).toContain('h-1/2');
    const parent = screen.getByText('api').closest('[data-highlight-item]') as HTMLElement;
    expect(parent.querySelector(':scope > span[aria-hidden]')?.className).toContain('top-7.5');
    const shop = screen.getByText('Shop').closest('section') as HTMLElement;
    expect(shop.hasAttribute('data-folded')).toBe(false);
    fireEvent.click(shop.querySelector('[data-disclosure-header]') as HTMLElement);
    expect(shop.hasAttribute('data-folded')).toBe(true);
    expect(shop.parentElement?.className).toContain('has-[>section:only-of-type[data-folded]]:pb-1.5');
  });

  it('draws each project as the compact queue draws a section, the play button in the column of the rows’ buttons', () => {
    renderPanel([{ project: SHOP, views: [running('api'), stopped('web'), stopped('docs')] }]);
    const shop = screen.getByText('Shop').closest('section') as HTMLElement;
    const header = shop.querySelector('[data-disclosure-header]') as HTMLElement;
    const { container } = render(
      <TooltipProvider>
        <TaskQueue state={QUEUE} variant='compact' />
      </TooltipProvider>
    );
    const queue = container.querySelector('section') as HTMLElement;
    const queueHeader = queue.querySelector('[data-disclosure-header]') as HTMLElement;
    expect(shop.className).toBe(queue.className);
    const classes = (element: Element | null) => element?.className.split(' ') ?? [];
    const shared = classes(queueHeader).filter((name) => !/^(h-|pe-|\[|outline-none$)/.test(name));
    expect(classes(header)).toEqual(expect.arrayContaining(shared));
    expect(classes(header.children[1] ?? null)).toEqual(classes(queueHeader.children[1] ?? null));
    expect(header.className).toMatch(/(^| )pe-1( |$)/);
    const row = within(shop).getByText('api').closest('[data-highlight-item]') as HTMLElement;
    expect(row.className).toMatch(/(^| )pe-1( |$)/);
    const chevron = header.querySelector('[data-disclosure-chevron]') as HTMLElement;
    expect(chevron.className).toContain('group-hover/disclosure:opacity-100');
    const play = within(shop).getByRole('button', { name: 'Start all services in Shop' });
    expect(chevron.compareDocumentPosition(play) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(shop).getByText('1 running').closest('[data-disclosure-header]')).toBe(header);
  });

  it('puts a section header’s chevron right after its counts, in the Services popover and the queue alike', () => {
    renderPanel([{ project: SHOP, views: [running('api'), stopped('web')] }]);
    const shop = screen.getByText('Shop').closest('section') as HTMLElement;
    const chevron = shop.querySelector('[data-disclosure-chevron]') as HTMLElement;
    expect(chevron.previousElementSibling?.textContent).toBe('1 running');
    expect(chevron.parentElement?.className).not.toContain('flex-1');
    const { container } = render(
      <TooltipProvider>
        <TaskQueue state={QUEUE} variant='compact' />
      </TooltipProvider>
    );
    const queueChevron = container.querySelector('[data-disclosure-chevron]') as HTMLElement;
    expect(queueChevron.parentElement?.textContent).toBe('1');
    expect(queueChevron.parentElement?.lastElementChild).toBe(queueChevron);
    expect(queueChevron.parentElement?.className).toBe(chevron.parentElement?.className);
  });

  it('keeps a running row’s Restart and Stop 1px apart, as the Terminal page’s pair is', () => {
    renderPanel([{ project: SHOP, views: [running('api')] }]);
    const restart = screen.getByRole('button', { name: 'Restart api' });
    const stop = screen.getByRole('button', { name: 'Stop api' });
    expect(restart.parentElement).toBe(stop.parentElement);
    expect(restart.parentElement?.className.split(' ')).toContain('gap-px');
  });

  it('starts a stopped service, restarts or stops a running one and opens its terminal from the row', () => {
    const { calls } = renderPanel([{ project: SHOP, views: [running('api'), stopped('web')] }]);
    fireEvent.click(screen.getByRole('button', { name: 'Start web' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restart api' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop api' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open the terminal of api' }));
    expect(screen.getByRole('button', { name: 'web' }).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: /^More for/ })).toBeNull();
    expect(calls).toEqual(['start web', 'restart api', 'stop api', 'open api']);
  });

  it('adds the ticked services found, inline, the recommended ones ticked and Select all in the list', async () => {
    const { sent } = renderPanel([{ project: SHOP, views: [running('api')] }]);
    fireEvent.click(screen.getByRole('button', { name: 'Add…' }));
    const add = await screen.findByRole('button', { name: 'Add 2 services' });
    expect(screen.getByRole('group', { name: 'Services found' }).textContent).toContain(
      'bun run dev in shop/apps/api'
    );
    expect(screen.getByRole('checkbox', { name: 'Add all' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByRole('combobox', { name: 'Project' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByRole('button', { name: 'Add 3 services' })).toBe(add);
    fireEvent.click(screen.getByRole('button', { name: 'Deselect all' }));
    expect(add.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByText('web'));
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 service' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent).toEqual([
      [
        'add',
        'shop',
        [{ name: 'web', cwd: `${ROOT}/apps/web`, command: 'bun run dev', env: {}, ...NO_PREVIEW }],
      ],
    ]);
    expect(await screen.findByRole('button', { name: 'Manage' })).toBeTruthy();
  });

  it('picks the project to add to when several are in view, and goes back to the list', async () => {
    renderPanel([{ project: BLOG, views: [running('blog')] }], { scope: [SHOP, BLOG], mode: 'add' });
    const picker = await screen.findByRole('combobox', { name: 'Project' });
    expect(picker.querySelector('[data-project-dot]')?.getAttribute('data-project-dot')).toBe('green');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: 'Add…' })).toBeTruthy();
  });

  it('adds a custom service from a short form, environment under Advanced, problems shown once touched', async () => {
    const { sent } = renderPanel([{ project: SHOP, views: [running('api')] }], { mode: 'add' });
    fireEvent.click(await screen.findByRole('button', { name: 'Custom service…' }));
    expect(screen.getByRole('heading', { name: 'Add a service' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Services found' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Folder' }).textContent).toBe('shop');
    expect(screen.queryByRole('textbox', { name: 'Environment' })).toBeNull();
    const name = screen.getByRole('textbox', { name: 'Name' });
    fireEvent.blur(name);
    expect(screen.queryByText('Give the service a name.')).toBeNull();
    fireEvent.change(name, { target: { value: 'w' } });
    fireEvent.change(name, { target: { value: '' } });
    fireEvent.blur(name);
    expect(screen.getByText('Give the service a name.')).toBeTruthy();
    expect(screen.queryByText('Give the command that starts it.')).toBeNull();
    fireEvent.change(name, { target: { value: 'worker' } });
    fireEvent.click(screen.getByRole('button', { name: 'Expand Advanced' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Environment' }), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Advanced' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add service' }));
    expect(await screen.findByText('Give the command that starts it.')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Environment' }).getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(screen.getByRole('textbox', { name: 'Environment' }), {
      target: { value: 'PORT=4000' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Command' }), {
      target: { value: 'bun worker.ts' },
    });
    expect(sent).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Add service' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent).toEqual([
      [
        'addOne',
        'shop',
        { name: 'worker', cwd: ROOT, command: 'bun worker.ts', env: { PORT: '4000' }, ...NO_PREVIEW },
      ],
    ]);
    expect(await screen.findByRole('button', { name: 'Manage' })).toBeTruthy();
  });

  it('adds a preview URL among the main fields and a port variable under Advanced, opening Advanced for its problem', async () => {
    const { sent } = renderPanel([{ project: SHOP, views: [] }], { mode: 'add' });
    fireEvent.click(await screen.findByRole('button', { name: 'Custom service…' }));
    expect(screen.queryByRole('textbox', { name: 'Port variable' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'web' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Command' }), { target: { value: 'next dev' } });
    const preview = screen.getByRole('textbox', { name: 'Preview URL' });
    fireEvent.change(preview, { target: { value: 'localhost:{port}' } });
    fireEvent.blur(preview);
    expect(
      screen.getByText('Give an http or https address, with {port} where the run’s port goes.')
    ).toBeTruthy();
    fireEvent.change(preview, { target: { value: 'http://localhost:{port}/shop' } });
    fireEvent.click(screen.getByRole('button', { name: 'Expand Advanced' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Port variable' }), { target: { value: '1PORT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Advanced' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add service' }));
    expect(await screen.findByText('Use letters, digits and _, not starting with a digit.')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Port variable' }), {
      target: { value: 'WEB_PORT' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add service' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual([
      'addOne',
      'shop',
      {
        name: 'web',
        cwd: ROOT,
        command: 'next dev',
        env: {},
        previewUrl: 'http://localhost:{port}/shop',
        portVariable: 'WEB_PORT',
      },
    ]);
  });

  it('opens a running service’s preview from its row, and offers none without a URL', () => {
    const web = resolveServiceView(
      createService({ id: 'web', previewUrl: 'http://localhost:{port}' }),
      createTerminal({ id: 't-web', serviceId: 'web', port: 4321, startedAt: NOW }),
      LATER
    );
    const { calls } = renderPanel([{ project: SHOP, views: [web, running('api')] }]);
    expect(screen.queryByRole('button', { name: 'Open api' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open web' }));
    expect(calls).toEqual(['preview web']);
  });

  it('goes back from the custom form to what was found', async () => {
    renderPanel([{ project: SHOP, views: [] }], { mode: 'add' });
    fireEvent.click(await screen.findByRole('button', { name: 'Custom service…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('button', { name: 'Add 2 services' })).toBeTruthy();
  });

  it('opens the form at once when nothing was found, and Back goes to the list', async () => {
    renderPanel([{ project: SHOP, views: [] }], { mode: 'add', suggestions: [] });
    expect(
      await screen.findByText(
        'No services found in Shop. Name the command that starts one and the folder it runs in.'
      )
    ).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('No services in Shop yet')).toBeTruthy();
  });

  it('ticks services in Manage and removes them in one go after an inline confirmation', async () => {
    const { sent } = renderPanel([
      { project: BLOG, views: [running('blog')] },
      { project: SHOP, views: [running('api'), stopped('web'), stopped('docs')] },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Manage' }));
    expect(screen.queryByRole('button', { name: /^Start all/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop api' })).toBeNull();
    const remove = screen.getByRole('button', { name: 'Remove services' });
    expect(remove.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select api' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select web' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove 2 services' }));
    expect(screen.getByText('Remove 2 services?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove 2 services' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect((sent[0] as [string, { id: string }[]])[1].map((service) => service.id)).toEqual(['api', 'web']);
    expect(await screen.findByRole('button', { name: 'Remove services' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('button', { name: 'Manage' })).toBeTruthy();
  });

  it('ticks a service when its row is pressed in Manage, and edits it only from its own button', () => {
    renderPanel([{ project: SHOP, views: [running('api'), stopped('web')] }], { mode: 'manage' });
    const api = screen.getByRole('checkbox', { name: 'Select api' });
    fireEvent.click(screen.getByText('api'));
    expect(api.getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('heading', { name: 'Edit api' })).toBeNull();
    fireEvent.click(screen.getByText('api'));
    expect(api.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(api);
    expect(api.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('button', { name: 'Remove 1 service' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit web' }));
    expect(screen.getByRole('heading', { name: 'Edit web' })).toBeTruthy();
  });

  it('draws Manage’s boxes as outlines and its edit button bare, with no wash under the pointer', () => {
    renderPanel([{ project: SHOP, views: [running('api')] }], { mode: 'manage' });
    expect(screen.getByRole('checkbox', { name: 'Select api' }).dataset.variant).toBe('outline');
    const edit = screen.getByRole('button', { name: 'Edit api' }).className.split(' ');
    expect(edit).toEqual(expect.arrayContaining(['before:hidden', 'not-disabled:hover:text-fg-4']));
    expect(edit.filter((name) => name.includes(':before:bg-'))).toEqual([]);
  });

  it('draws the found services’ boxes as outlines too', async () => {
    renderPanel([{ project: SHOP, views: [] }], { mode: 'add' });
    const box = await screen.findByRole('checkbox', { name: 'Add api' });
    expect(box.dataset.variant).toBe('outline');
  });

  it('pads every view’s header as far from the top as from the side', async () => {
    renderPanel([{ project: SHOP, views: [running('api')] }], { mode: 'add' });
    const headers = [await screen.findByRole('heading', { name: 'Add services' })];
    fireEvent.click(screen.getByRole('button', { name: 'Custom service…' }));
    headers.push(screen.getByRole('heading', { name: 'Add a service' }));
    for (const heading of headers) {
      const classes = heading.parentElement?.parentElement?.className.split(' ') ?? [];
      expect(classes).toEqual(expect.arrayContaining(['py-3', 'ps-3']));
      expect(classes.some((name) => /^(?:min-h|h)-/.test(name))).toBe(false);
    }
  });

  it('edits a service inline from Manage and comes back with the ticks kept', async () => {
    const { sent } = renderPanel([{ project: SHOP, views: [running('api'), stopped('web')] }], {
      mode: 'manage',
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select web' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit api' }));
    expect(screen.getByRole('heading', { name: 'Edit api' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit api' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'server' } });
    expect(screen.getByRole('heading', { name: 'Edit server' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect((sent[0] as [string, { id: string }, { name: string }])[2].name).toBe('server');
    expect(await screen.findByRole('button', { name: 'Remove 1 service' })).toBeTruthy();
  });
});
