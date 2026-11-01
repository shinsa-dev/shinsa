import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { toast } from '@shinsa/ui/components/sonner';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NewTaskForm } from '@/components/home/new-task-form.tsx';
import { connection, type MachineChoice, replaceConnection } from '@/lib/connection/socket.ts';
import { listSentCommands, pushState, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createProject, createShinsaState, createTask } from '../../support/state.ts';

function renderForm() {
  render(
    <TooltipProvider>
      <NewTaskForm />
    </TooltipProvider>
  );
}

function combobox(name: string) {
  return screen.getByRole('combobox', { name });
}

async function listOptions(select: string) {
  fireEvent.click(combobox(select));
  const options = await screen.findAllByRole('option');
  return options.map((option) => option.textContent);
}

async function pick(select: string, option: RegExp, shown: string | RegExp) {
  fireEvent.click(combobox(select));
  const item = await screen.findByRole('option', { name: option });
  fireEvent.pointerDown(item, { pointerType: 'mouse' });
  fireEvent.click(item);
  await waitFor(() => expect(combobox(select).textContent).toMatch(shown));
}

function field() {
  return screen.getByRole('textbox', { name: 'Describe the work' });
}

async function send(button: string) {
  fireEvent.click(screen.getByRole('button', { name: button }));
  await waitFor(() => expect(listSentCommands()).toHaveLength(1));
}

const PROJECTS = [
  createProject({ id: 'p1', name: 'Superwall', key: 'SUP' }),
  createProject({ id: 'p2', name: 'Basket', color: 'green', key: 'BAS' }),
];

function pushProjects(focus: string | null) {
  pushState(
    createShinsaState({
      projects: PROJECTS,
      tasks: [
        createTask({ id: 'base', title: 'Fix the schema', stage: 'building' }),
        createTask({ id: 'paywall', title: 'Redo the paywall', stage: 'building', projectId: 'p1' }),
        createTask({ id: 'basket', title: 'Count the baskets', stage: 'building', projectId: 'p2' }),
      ],
      patch: { focus: { projectId: focus, until: null } },
    })
  );
}

beforeEach(() => {
  startFakeServer();
  pushProjects(null);
});

afterEach(() => {
  replaceConnection(null);
  stopFakeServer();
});

function connectTwoMachines(studioCapacity = 4) {
  const local = connection;
  const sent: [string, string | null | undefined][] = [];
  const studio = { id: 'studio', name: 'Studio', current: false };
  const machines: MachineChoice[] = [
    {
      ...studio,
      state: {
        tasks: { a: { stage: 'building' as const } },
        projects: { p1: { name: 'Superwall', description: '' }, p2: { name: 'Paywalls', description: '' } },
        repos: {},
        settings: { taskCapacity: studioCapacity },
      },
    },
    {
      id: 'box',
      name: 'Build box',
      current: false,
      state: {
        tasks: {},
        projects: {},
        repos: {},
        settings: { taskCapacity: null, placementPolicies: ['Benchmarks run on the build box.'] },
      },
    },
  ];
  replaceConnection({
    ...local,
    listMachines: () => machines,
    selectMachine: (id: string) => (id === 'p1' || id === 'p2' ? studio : null),
    command: (command, machineId) => {
      sent.push([command.type, machineId]);
      return Promise.resolve();
    },
  });
  return sent;
}

describe('NewTaskForm with several machines', () => {
  it('shows a machine this device cannot reach in the picker, disabled with what to do', async () => {
    const local = connection;
    const machines: MachineChoice[] = [
      {
        id: 'studio',
        name: 'Studio',
        current: true,
        state: { tasks: {}, projects: {}, repos: {}, settings: {} },
      },
    ];
    const unreachable = [{ id: 'laptop', name: 'Laptop' }];
    replaceConnection({
      ...local,
      listMachines: () => machines,
      listUnreachableMachines: () => unreachable,
    });
    renderForm();
    expect(combobox('Machine').textContent).toBe('Automatic');
    fireEvent.click(combobox('Machine'));
    const laptop = await screen.findByRole('option', { name: /Laptop/ });
    expect(laptop.getAttribute('aria-disabled')).toBe('true');
    expect(laptop.textContent).toContain('Add this device on Laptop first');
  });

  it('shows no machine picker with one machine', () => {
    renderForm();
    expect(screen.queryByRole('combobox', { name: 'Machine' })).toBeNull();
  });

  it('lets the router place a task, and on the machine you pick with only that machine’s projects', async () => {
    const sent = connectTwoMachines();
    const realFetch = globalThis.fetch;
    const asked: unknown[] = [];
    globalThis.fetch = mock((_url: string, init: RequestInit) => {
      asked.push(JSON.parse(String(init.body)));
      return Promise.resolve(
        Response.json({ answer: { machineId: 'studio', reason: 'Studio runs reviews.' } })
      );
    }) as unknown as typeof globalThis.fetch;
    renderForm();
    expect(combobox('Machine').textContent).toBe('Automatic');
    fireEvent.change(field(), { target: { value: 'Review the build' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(sent).toEqual([['task.create', 'studio']]));
    globalThis.fetch = realFetch;
    expect(asked).toMatchObject([{ request: 'Review the build' }]);
    await pick('Project', /Superwall on Studio/, /Superwall/);
    expect(combobox('Machine').textContent).toBe('Automatic');
    await pick('Machine', /Build box/, 'Build box');
    expect(combobox('Project').textContent).toBe('No project');
    expect(await listOptions('Project')).toEqual(['No project']);
  });

  it('sends the task where there is room when the router names a full machine', async () => {
    const sent = connectTwoMachines(1);
    const realFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(Response.json({ answer: { machineId: 'studio', reason: 'Studio runs reviews.' } }))
    ) as unknown as typeof globalThis.fetch;
    renderForm();
    fireEvent.change(field(), { target: { value: 'Review the build' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(sent).toEqual([['task.create', 'box']]));
    globalThis.fetch = realFetch;
  });

  it('warns when the router could not be asked, and still places the task', async () => {
    const sent = connectTwoMachines();
    const warned = spyOn(toast, 'warning').mockReturnValue('id');
    const realFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(Response.json({ error: { message: 'No Claude account.' } }, { status: 400 }))
    ) as unknown as typeof globalThis.fetch;
    renderForm();
    fireEvent.change(field(), { target: { value: 'Review the build' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    globalThis.fetch = realFetch;
    expect(warned).toHaveBeenCalledWith('Couldn’t ask the router. Placed by room.');
    warned.mockRestore();
  });
});

function serveUploads() {
  const realFetch = globalThis.fetch;
  globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
    const { name, mimeType } = JSON.parse(String(init.body)) as { name: string; mimeType: string | null };
    return Response.json({
      kind: mimeType?.startsWith('image/') ? 'image' : 'file',
      name,
      url: `/api/attachments/1/${name}`,
      path: `/data/attachments/1/${name}`,
      mimeType,
      size: 1,
    });
  }) as unknown as typeof globalThis.fetch;
  const created = spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
  return () => {
    globalThis.fetch = realFetch;
    created.mockRestore();
  };
}

describe('NewTaskForm attachments', () => {
  it('fades the text where it scrolls under the attachments and the footer', () => {
    renderForm();
    expect(field().classList.contains('scroll-fade')).toBe(true);
  });

  it('sends a pasted image and a dropped file with the request, as the attachments block', async () => {
    const restore = serveUploads();
    renderForm();
    fireEvent.paste(field(), {
      clipboardData: { files: [new File(['x'], 'shot.png', { type: 'image/png' })] },
    });
    const form = field().parentElement as HTMLElement;
    const dataTransfer = { files: [new File(['y'], 'log.txt', { type: 'text/plain' })], types: ['Files'] };
    fireEvent.dragOver(form, { dataTransfer });
    fireEvent.dragLeave(form, { dataTransfer, relatedTarget: null });
    fireEvent.dragOver(form, { dataTransfer: { files: [], types: ['text/plain'] } });
    fireEvent.drop(form, { dataTransfer: { files: [], types: ['text/plain'] } });
    fireEvent.drop(form, { dataTransfer });
    await waitFor(() => expect(screen.queryAllByLabelText(/^Attaching/)).toHaveLength(0));
    expect(screen.getByRole('img', { name: 'shot.png' })).toBeTruthy();
    expect(screen.getByText('log.txt')).toBeTruthy();
    await send('Start');
    const [command] = listSentCommands() as { request: string }[];
    expect(command?.request).toBe(
      [
        '<attachments>',
        '<attachment kind="image" display_name="shot.png" mime_type="image/png" size_bytes="1" path="/data/attachments/1/shot.png" url="/api/attachments/1/shot.png" />',
        '<attachment kind="file" display_name="log.txt" mime_type="text/plain" size_bytes="1" path="/data/attachments/1/log.txt" url="/api/attachments/1/log.txt" />',
        '</attachments>',
      ].join('\n')
    );
    expect(screen.queryByRole('list', { name: 'Attachments' })).toBeNull();
    restore();
  });

  it('attaches from the file picker and removes a file you take back', async () => {
    const restore = serveUploads();
    renderForm();
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    fireEvent.click(screen.getByRole('button', { name: 'Attach files' }));
    fireEvent.change(input, { target: { files: [new File(['z'], 'spec.md')] } });
    fireEvent.change(input, { target: { files: null } });
    await waitFor(() => expect(screen.getByText('spec.md')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Remove spec.md' }));
    expect(screen.queryByText('spec.md')).toBeNull();
    fireEvent.paste(field(), { clipboardData: { files: [] } });
    restore();
  });
});

describe('NewTaskForm', () => {
  it('has no kind of task: it starts on the project, then Auto start and priority', async () => {
    renderForm();
    expect(screen.getAllByRole('combobox').map((element) => element.getAttribute('aria-label'))).toEqual([
      'Project',
      'When to start',
      'Priority',
    ]);
    expect(['Project', 'When to start', 'Priority'].map((name) => combobox(name).textContent)).toEqual([
      'No project',
      'Auto start',
      'Auto priority',
    ]);
    expect(field().getAttribute('placeholder')).toBe(
      'Describe the work or ask a question. Shinsa decides what kind of task it is.'
    );
    fireEvent.change(field(), { target: { value: '  Exports stall at night  ' } });
    await send('Start');
    expect(listSentCommands()).toEqual([
      { type: 'task.create', request: 'Exports stall at night', repoId: null },
    ]);
  });

  it('starts on the focus project and lists every project after No project', async () => {
    pushProjects('p1');
    renderForm();
    expect(combobox('Project').textContent).toBe('Superwall');
    expect(await listOptions('Project')).toEqual(['No project', 'Basket', 'Superwall']);
  });

  it('offers four ways to start, each with its hint', async () => {
    pushProjects('p1');
    renderForm();
    expect(await listOptions('When to start')).toEqual([
      'Auto startNow, or after work it builds on',
      'Start nowNow, even if related work is open',
      'After another task…When the tasks you pick finish',
      'BacklogPlans now, builds when you start it',
    ]);
  });

  it('sends the project, start and priority you pick, then goes back to the defaults', async () => {
    pushProjects('p1');
    renderForm();
    await pick('Project', /Basket/, 'Basket');
    await pick('When to start', /Start now/, 'Start now');
    await pick('Priority', /High priority/, /High/);
    fireEvent.change(field(), { target: { value: 'Why do exports stall?' } });
    await send('Start');
    expect(listSentCommands()).toEqual([
      {
        type: 'task.create',
        request: 'Why do exports stall?',
        repoId: null,
        projectId: 'p2',
        priority: 'high',
        waitsOn: [],
      },
    ]);
    await waitFor(() => expect(combobox('Project').textContent).toBe('Superwall'));
  });

  it('waits on open tasks of any project, picked from a search, and names them', async () => {
    pushProjects('p1');
    renderForm();
    await pick('Project', /No project/, 'No project');
    fireEvent.click(combobox('When to start'));
    const after = await screen.findByRole('option', { name: /After another task/ });
    fireEvent.pointerDown(after, { pointerType: 'mouse' });
    fireEvent.click(after);
    const search = await screen.findByPlaceholderText('Search open tasks');
    fireEvent.change(search, { target: { value: 'basket' } });
    await waitFor(() => expect(screen.queryByRole('option', { name: /Redo the paywall/ })).toBeNull());
    fireEvent.click(await screen.findByRole('option', { name: /Count the baskets/ }));
    fireEvent.change(search, { target: { value: '' } });
    fireEvent.click(await screen.findByRole('option', { name: /Fix the schema/ }));
    await waitFor(() =>
      expect(combobox('When to start').textContent).toBe('After Fix the schema and 1 more')
    );
    fireEvent.click(await screen.findByRole('option', { name: /Fix the schema/ }));
    await waitFor(() => expect(combobox('When to start').textContent).toBe('After Count the baskets'));
    fireEvent.change(field(), { target: { value: 'How are exports chunked?' } });
    await send('Add');
    expect(listSentCommands()).toEqual([
      {
        type: 'task.create',
        request: 'How are exports chunked?',
        repoId: null,
        projectId: null,
        waitsOn: ['basket'],
      },
    ]);
  });

  it('adds a task to the backlog', async () => {
    pushProjects(null);
    renderForm();
    await pick('When to start', /Backlog/, 'Backlog');
    fireEvent.change(field(), { target: { value: 'Add search to the docs' } });
    await send('Add');
    expect(listSentCommands()).toEqual([
      { type: 'task.create', request: 'Add search to the docs', repoId: null, backlog: true },
    ]);
  });
});
