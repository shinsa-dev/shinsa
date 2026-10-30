import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { CoverageSetting, Project, ProjectInput, Repo, ShinsaState } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ProjectSettings } from '@/components/settings/projects.tsx';
import { type CoverageDetectionMap, resetCoverageDetection } from '@/lib/connection/coverage.ts';
import type { ProjectActions } from '@/lib/projects.ts';
import { findTooltipText } from '../../support/hover.ts';
import { createWatchSuggestion } from '../../support/schedules.ts';
import { createProject, createRepo, createShinsaState } from '../../support/state.ts';
import { waitForGone } from '../../support/wait.ts';

const SUPERWALL = createProject({
  id: 'p1',
  name: 'Superwall',
  key: 'SW',
  description: 'Paywalls and the SDKs',
  folders: ['/Users/you/Developer/Superwall'],
});

function createActions(overrides: Partial<ProjectActions> = {}) {
  const actions = {
    write: mock(async () => true),
    save: mock(async (_input: ProjectInput, _done: string): Promise<string | null> => null),
    remove: mock(async () => true),
    listLocalRepos: mock(async () => [
      { path: '/Users/you/Developer/zed', name: 'zed', repoId: null, projectId: null },
    ]),
    addRepo: mock(async () => true),
    removeRepo: mock(async (_repo: Repo) => true),
    addFolder: mock(async (_project: Project, _path: string): Promise<string | null> => null),
    removeFolder: mock(async () => true),
    changeWorkspace: mock(async (_repo: Repo, _mode: string) => true),
    changeCoverage: mock(async (_repo: Repo, _setting: CoverageSetting) => true),
    changeBaseline: mock(async (_repo: Repo, _commands: string[]) => true),
  };
  return Object.assign(actions, overrides) as typeof actions;
}

let detected: CoverageDetectionMap = {};

beforeEach(() => {
  resetCoverageDetection();
  detected = {};
  spyOn(globalThis, 'fetch').mockImplementation((async () =>
    Response.json({ detected })) as unknown as typeof fetch);
});

afterEach(() => {
  mock.restore();
});

async function chooseWorkspace(repo: string, option: string) {
  fireEvent.click(screen.getByRole('combobox', { name: `Where agents work in ${repo}` }));
  await settle();
  const list = screen.getAllByRole('listbox').at(-1) as HTMLElement;
  const item = within(list).getByRole('option', { name: new RegExp(`^${option}`) });
  fireEvent.pointerDown(item, { pointerType: 'mouse' });
  fireEvent.click(item);
  await settle();
  return item;
}

function renderProjects(state: ShinsaState, actions = createActions()) {
  render(
    <TooltipProvider>
      <ProjectSettings state={state} actions={actions} />
    </TooltipProvider>
  );
  return actions;
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

async function openMenuItem(name: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Project options' }));
  await settle();
  fireEvent.click(screen.getByRole('menuitem', { name }));
  await settle();
}

async function openAddFolder() {
  fireEvent.click(screen.getByRole('button', { name: 'Add to Superwall' }));
  await settle();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Folder by its path…' }));
  await settle();
}

function superwallState() {
  return createShinsaState({
    projects: [SUPERWALL],
    repos: [createRepo({ id: 'web', projectId: 'p1' }), createRepo({ id: 'notes' })],
  });
}

describe('Settings → Projects', () => {
  it('asks for a first project when there is nothing to show', () => {
    renderProjects(createShinsaState({}));
    expect(screen.getByText('Create a project for the repositories you work on together.')).toBeDefined();
  });

  it('shows each project’s key, then its repositories and folders, each by name and path', async () => {
    renderProjects(superwallState());
    expect(await findTooltipText(screen.getByText('SW'))).toBe('Tasks in this project are named SW-1, SW-2…');
    expect(screen.queryByText('Paywalls and the SDKs')).toBeNull();
    expect(screen.getByText('web')).toBeDefined();
    expect(screen.getAllByText('Superwall')).toHaveLength(2);
    expect(screen.getByText('/Users/you/Developer/Superwall')).toBeDefined();
    expect(screen.getByText('No project')).toBeDefined();
    expect(screen.getByText('notes')).toBeDefined();
  });

  it('changes the key, and keeps the dialog open with the server’s refusal', async () => {
    const actions = createActions({
      save: mock(async (): Promise<string | null> => 'Basket already uses BAS.'),
    });
    renderProjects(superwallState(), actions);
    await openMenuItem('Change key…');
    const field = screen.getByLabelText('Key');
    expect(screen.getByText('2 to 6 letters or digits, starting with a letter.')).toBeDefined();
    fireEvent.change(field, { target: { value: '9x' } });
    fireEvent.submit(field.closest('form') as HTMLFormElement);
    await settle();
    expect(screen.getByText('Use 2 to 6 letters or digits, starting with a letter.')).toBeDefined();
    expect(actions.save).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: 'bas' } });
    fireEvent.submit(field.closest('form') as HTMLFormElement);
    await waitFor(() => expect(screen.getByText('Basket already uses BAS.')).toBeDefined());
    expect(actions.save.mock.calls[0]?.[0]).toMatchObject({ id: 'p1', key: 'BAS' });
    fireEvent.change(field, { target: { value: 'SWK' } });
    expect(screen.queryByText('Basket already uses BAS.')).toBeNull();
  });

  it('keeps Rename busy until the dialog has closed after a save', async () => {
    const saved = Promise.withResolvers<string | null>();
    renderProjects(superwallState(), createActions({ save: mock(() => saved.promise) }));
    await openMenuItem('Rename…');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Paywalls' } });
    fireEvent.submit(screen.getByLabelText('Name').closest('form') as HTMLFormElement);
    const button = screen.getByRole('button', { name: /Rename$/ });
    expect(button.getAttribute('aria-busy')).toBe('true');
    const changes: MutationRecord[] = [];
    const observer = new MutationObserver((records) => changes.push(...records));
    observer.observe(button, { attributes: true, attributeFilter: ['aria-busy'] });
    await act(async () => {
      saved.resolve(null);
      await saved.promise;
    });
    await waitForGone(() => screen.queryByLabelText('Name'));
    changes.push(...observer.takeRecords());
    observer.disconnect();
    expect(changes).toEqual([]);
  });

  it('saves the description with Enter', async () => {
    const actions = renderProjects(superwallState());
    await openMenuItem('Edit description…');
    const field = screen.getByLabelText('Description');
    fireEvent.change(field, { target: { value: 'Paywalls' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(actions.save).toHaveBeenCalled());
    expect(actions.save.mock.calls[0]).toEqual([
      expect.objectContaining({ description: 'Paywalls' }),
      'Description saved.',
    ]);
  });

  it('offers to add a description when there is none, and says when a project holds nothing yet', async () => {
    renderProjects(createShinsaState({ projects: [{ ...SUPERWALL, description: '', folders: [] }] }));
    expect(screen.getByText('No repositories or folders yet.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Project options' }));
    await settle();
    expect(screen.getByRole('menuitem', { name: 'Add description…' })).toBeDefined();
  });

  it('adds a repository found on disk and removes one', async () => {
    const actions = renderProjects(superwallState());
    fireEvent.click(screen.getByRole('button', { name: 'Add to Superwall' }));
    await waitFor(() => expect(screen.getByText('In your folders')).toBeDefined());
    fireEvent.click(screen.getByText('zed'));
    expect(actions.addRepo).toHaveBeenCalledWith(SUPERWALL, '/Users/you/Developer/zed');
    fireEvent.click(screen.getByRole('button', { name: 'Remove web from the project' }));
    expect(actions.removeRepo.mock.calls[0]?.[0]).toMatchObject({ id: 'web' });
  });

  it('says why the repositories could not be listed', async () => {
    renderProjects(
      superwallState(),
      createActions({ listLocalRepos: mock(async () => Promise.reject(new Error('Couldn’t reach Shinsa.'))) })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add to Superwall' }));
    await waitFor(() => expect(screen.getByText('Couldn’t reach Shinsa.')).toBeDefined());
  });

  it('adds a folder by its path, shows a refusal under it, and removes one', async () => {
    const addFolder = mock(
      async (_project: Project, path: string): Promise<string | null> =>
        path === '~/Nope' ? 'There is no folder at ~/Nope.' : null
    );
    const actions = renderProjects(superwallState(), createActions({ addFolder }));
    expect(screen.queryByLabelText('Add a folder to Superwall')).toBeNull();
    await openAddFolder();
    fireEvent.keyDown(screen.getByLabelText('Add a folder to Superwall'), { key: 'Escape' });
    expect(screen.queryByLabelText('Add a folder to Superwall')).toBeNull();
    await openAddFolder();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Add a folder to Superwall')).toBeNull();
    await openAddFolder();
    const field = screen.getByLabelText('Add a folder to Superwall');
    fireEvent.change(field, { target: { value: 'Developer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add folder' }));
    await settle();
    expect(screen.getByText('Use the full path, starting with / or ~/.')).toBeDefined();
    fireEvent.change(field, { target: { value: '~/Nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add folder' }));
    await waitFor(() => expect(screen.getByText('There is no folder at ~/Nope.')).toBeDefined());
    await settle();
    fireEvent.change(field, { target: { value: '~/Developer/Basket' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add folder' }));
    await settle();
    expect(screen.queryByLabelText('Add a folder to Superwall')).toBeNull();
    expect(addFolder).toHaveBeenLastCalledWith(SUPERWALL, '~/Developer/Basket');
    fireEvent.click(screen.getByRole('button', { name: 'Remove the Superwall folder' }));
    expect(actions.removeFolder).toHaveBeenCalledWith(SUPERWALL, '/Users/you/Developer/Superwall');
  });

  it('creates a project, deriving the key when none is typed', async () => {
    const actions = renderProjects(createShinsaState({}));
    fireEvent.click(screen.getByRole('button', { name: 'New project' }));
    await settle();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Basket' } });
    fireEvent.submit(screen.getByLabelText('Name').closest('form') as HTMLFormElement);
    await waitFor(() => expect(actions.save).toHaveBeenCalled());
    expect(actions.save.mock.calls[0]).toEqual([
      { name: 'Basket', description: '', color: 'blue' },
      'Project created. Add its repositories or folders.',
    ]);
  });

  it('renames, recolours and removes a project from its menu', async () => {
    const actions = renderProjects(superwallState());
    fireEvent.click(screen.getByRole('button', { name: 'Project options' }));
    await settle();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Colour' }));
    await settle();
    fireEvent.click(screen.getByRole('menuitem', { name: 'green' }));
    expect(actions.write.mock.calls[0]).toEqual([
      expect.objectContaining({ id: 'p1', color: 'green' }),
      'Colour changed.',
    ] as never);
    fireEvent.click(screen.getByRole('button', { name: 'Project options' }));
    await settle();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename…' }));
    await settle();
    expect(screen.getByLabelText('Name')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Project options' }));
    await settle();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove project' }));
    await settle();
    expect(screen.getByText('Remove Superwall?')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Remove project' }));
    await waitFor(() =>
      expect(actions.remove).toHaveBeenCalledWith(
        SUPERWALL,
        'Project removed. Its repositories have no project now.'
      )
    );
  });

  it('each repository says where agents work, and offers worktrees or the main checkout', async () => {
    const actions = renderProjects(superwallState());
    await settle();
    const web = screen.getByRole('combobox', { name: 'Where agents work in web' });
    expect(web.textContent).toContain('Worktrees');
    fireEvent.click(web);
    await settle();
    const list = screen.getAllByRole('listbox').at(-1) as HTMLElement;
    expect(within(list).getAllByRole('option')).toHaveLength(2);
    expect(within(list).getByRole('option', { name: /^Worktrees/ })).toBeTruthy();
    expect(within(list).getByRole('option', { name: /^Main checkout/ })).toBeTruthy();
    fireEvent.keyDown(list, { key: 'Escape' });
    await settle();
    await chooseWorkspace('notes', 'Main checkout');
    expect(actions.changeWorkspace.mock.calls[0]?.[1]).toBe('main_checkout');
  });

  it('sets each repository’s test coverage: Auto says what it found, Custom asks for the command and report', async () => {
    detected = { web: { tool: 'Vitest', command: 'npx vitest run --coverage' } };
    const actions = renderProjects(superwallState());
    await settle();
    const web = screen.getByRole('combobox', { name: 'Test coverage in web' });
    expect(web.textContent).toContain('Auto coverage');
    fireEvent.click(web);
    await settle();
    let list = screen.getAllByRole('listbox').at(-1) as HTMLElement;
    expect(within(list).getByRole('option', { name: /^Auto coverage/ }).textContent).toContain(
      'Measures with Vitest.'
    );
    const off = within(list).getByRole('option', { name: /^Coverage off/ });
    fireEvent.pointerDown(off, { pointerType: 'mouse' });
    fireEvent.click(off);
    await settle();
    expect(actions.changeCoverage.mock.calls[0]?.[1]).toEqual({ mode: 'off' });
    fireEvent.click(screen.getByRole('combobox', { name: 'Test coverage in notes' }));
    await settle();
    list = screen.getAllByRole('listbox').at(-1) as HTMLElement;
    expect(within(list).getByRole('option', { name: /^Auto coverage/ }).textContent).toContain(
      'Found no coverage tool here'
    );
    const custom = within(list).getByRole('option', { name: /^Custom coverage/ });
    fireEvent.pointerDown(custom, { pointerType: 'mouse' });
    fireEvent.click(custom);
    await settle();
    expect(screen.getByText('Custom test coverage')).toBeDefined();
    const command = screen.getByLabelText('Command');
    fireEvent.submit(command.closest('form') as HTMLFormElement);
    await settle();
    expect(screen.getByText('Give the command that writes the report.')).toBeDefined();
    fireEvent.change(command, { target: { value: 'make cover' } });
    fireEvent.change(screen.getByLabelText('Report'), { target: { value: 'out/report.txt' } });
    fireEvent.submit(command.closest('form') as HTMLFormElement);
    await settle();
    expect(screen.getByText('Shinsa cannot tell the format from the path. Choose one.')).toBeDefined();
    fireEvent.change(screen.getByLabelText('Report'), { target: { value: 'out/cover.out' } });
    expect(screen.queryByText('Shinsa cannot tell the format from the path. Choose one.')).toBeNull();
    fireEvent.submit(command.closest('form') as HTMLFormElement);
    await settle();
    expect(actions.changeCoverage.mock.calls[1]?.[1]).toEqual({
      mode: 'custom',
      command: 'make cover',
      report: 'out/cover.out',
      format: null,
    });
    await waitForGone(() => screen.queryByText('Custom test coverage'));
  });

  it('edits a custom coverage command, and keeps the dialog open when saving fails', async () => {
    const actions = createActions({ changeCoverage: mock(async () => false) });
    renderProjects(
      createShinsaState({
        repos: [
          createRepo({
            id: 'web',
            coverage: { mode: 'custom', command: 'make cover', report: 'cover.xml', format: null },
          }),
        ],
      }),
      actions
    );
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Edit the coverage command for web' }));
    await settle();
    const command = screen.getByLabelText('Command') as HTMLInputElement;
    expect(command.value).toBe('make cover');
    fireEvent.click(screen.getByRole('combobox', { name: 'Format' }));
    await settle();
    const list = screen.getAllByRole('listbox').at(-1) as HTMLElement;
    expect(within(list).getByRole('option', { name: 'Infer from the path: Cobertura XML' })).toBeDefined();
    const lcov = within(list).getByRole('option', { name: 'LCOV' });
    fireEvent.pointerDown(lcov, { pointerType: 'mouse' });
    fireEvent.click(lcov);
    await settle();
    fireEvent.submit(command.closest('form') as HTMLFormElement);
    await settle();
    expect(actions.changeCoverage.mock.calls[0]?.[1]).toMatchObject({ format: 'lcov' });
    expect(screen.getByText('Custom test coverage')).toBeDefined();
  });

  it('sets what always runs before review: nothing, or your commands one per line', async () => {
    const actions = createActions();
    renderProjects(
      createShinsaState({
        repos: [createRepo({ id: 'web', checkCommands: ['bun run lint'] }), createRepo({ id: 'notes' })],
      }),
      actions
    );
    await settle();
    const web = screen.getByRole('combobox', { name: 'Always run before review in web' });
    expect(web.textContent).toContain('1 command before review');
    expect(screen.getByRole('combobox', { name: 'Always run before review in notes' }).textContent).toContain(
      'Nothing before review'
    );
    fireEvent.click(web);
    await settle();
    const list = screen.getAllByRole('listbox').at(-1) as HTMLElement;
    const none = within(list).getByRole('option', { name: /^Nothing before review/ });
    fireEvent.pointerDown(none, { pointerType: 'mouse' });
    fireEvent.click(none);
    await settle();
    expect(actions.changeBaseline.mock.calls[0]?.[1]).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Edit the commands that run before review in web' }));
    await settle();
    const field = screen.getByLabelText('Commands') as HTMLTextAreaElement;
    expect(field.value).toBe('bun run lint');
    fireEvent.change(field, { target: { value: `bun run lint\n${'x'.repeat(201)}` } });
    fireEvent.submit(field.closest('form') as HTMLFormElement);
    await settle();
    expect(screen.getByText(/is longer than 200 characters/)).toBeDefined();
    fireEvent.change(field, { target: { value: ' bun run lint \n\nbun run --cwd apps/web check-types\n' } });
    fireEvent.submit(field.closest('form') as HTMLFormElement);
    await settle();
    expect(actions.changeBaseline.mock.calls[1]?.[1]).toEqual([
      'bun run lint',
      'bun run --cwd apps/web check-types',
    ]);
    await waitForGone(() =>
      screen.queryByText('One per line. Keep them quick: CI runs the whole suite on the pull request.')
    );
  });

  it('opens the commands dialog from Nothing before review, and keeps it open when saving fails', async () => {
    const actions = createActions({ changeBaseline: mock(async () => false) });
    renderProjects(createShinsaState({ repos: [createRepo({ id: 'notes' })] }), actions);
    await settle();
    fireEvent.click(screen.getByRole('combobox', { name: 'Always run before review in notes' }));
    await settle();
    const list = screen.getAllByRole('listbox').at(-1) as HTMLElement;
    const commands = within(list).getByRole('option', { name: /^Commands before review/ });
    fireEvent.pointerDown(commands, { pointerType: 'mouse' });
    fireEvent.click(commands);
    await settle();
    const field = screen.getByLabelText('Commands');
    fireEvent.change(field, { target: { value: 'bun run lint' } });
    fireEvent.submit(field.closest('form') as HTMLFormElement);
    await settle();
    expect(actions.changeBaseline.mock.calls[0]?.[1]).toEqual(['bun run lint']);
    expect(screen.getByText('Always run before review', { selector: 'h2' })).toBeDefined();
  });
});

describe('a suggested watch under its integration', () => {
  it('shows the open suggestion right below the integration it reads, without the project', () => {
    const project = {
      ...SUPERWALL,
      watchSources: [
        { server: 'slack', data: 'The #feedback channel', repoIds: [], addedBy: 'you' as const, addedAt: 0 },
        { server: 'maple', data: 'Errors', repoIds: [], addedBy: 'you' as const, addedAt: 0 },
      ],
    };
    const state = createShinsaState({
      projects: [project],
      patch: { watchSuggestions: { s1: createWatchSuggestion({ id: 's1' }) } },
    });
    renderProjects(state);
    const suggestion = screen.getByText('File a task for each new bug in #feedback.');
    const row = suggestion.closest('div.flex.min-w-0.flex-1')?.parentElement?.parentElement;
    expect(row?.previousElementSibling?.textContent).toContain('slack');
    expect(screen.getByText('slack · every hour')).toBeDefined();
    expect(screen.getAllByRole('button', { name: 'Add the watch' })).toHaveLength(1);
  });
});
