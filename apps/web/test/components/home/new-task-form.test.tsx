import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
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

function connectTwoMachines() {
  const local = connection;
  const sent: [string, string | null | undefined][] = [];
  const studio = { id: 'studio', name: 'Studio', current: false };
  const machines: MachineChoice[] = [
    {
      ...studio,
      state: {
        tasks: { a: { stage: 'building' as const } },
        projects: { p1: {}, p2: {} },
        settings: { taskCapacity: 4 },
      },
    },
    {
      id: 'box',
      name: 'Build box',
      current: false,
      state: {
        tasks: {},
        projects: {},
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
  it('shows no machine picker with one machine', () => {
    renderForm();
    expect(screen.queryByRole('combobox', { name: 'Machine' })).toBeNull();
  });

  it('lets the policies place a task, and on the machine you pick with only that machine’s projects', async () => {
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
    expect(combobox('Machine').textContent).toBe('Automatic: Studio');
    await pick('Machine', /Build box/, 'Build box');
    expect(combobox('Project').textContent).toBe('No project');
    expect(await listOptions('Project')).toEqual(['No project']);
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

  it('offers to wait only on open tasks of the focus project', async () => {
    pushProjects('p1');
    renderForm();
    expect(await listOptions('When to start')).toEqual(['Auto start', 'Start now', 'After Redo the paywall']);
  });

  it('offers to wait only on open tasks of the project you pick', async () => {
    pushProjects('p1');
    renderForm();
    await pick('Project', /Basket/, 'Basket');
    expect(await listOptions('When to start')).toEqual([
      'Auto start',
      'Start now',
      'After Count the baskets',
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

  it('sends No project as no project, and adds a task that waits on another', async () => {
    pushProjects('p1');
    renderForm();
    await pick('Project', /No project/, 'No project');
    await pick('When to start', /After Fix the schema/, 'After Fix the schema');
    fireEvent.change(field(), { target: { value: 'How are exports chunked?' } });
    await send('Add');
    expect(listSentCommands()).toEqual([
      {
        type: 'task.create',
        request: 'How are exports chunked?',
        repoId: null,
        projectId: null,
        waitsOn: ['base'],
      },
    ]);
  });
});
