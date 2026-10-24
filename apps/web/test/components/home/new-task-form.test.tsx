import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NewTaskForm } from '@/components/home/new-task-form.tsx';
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
  stopFakeServer();
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
