import { describe, expect, it, mock } from 'bun:test';
import type { Project, ProjectInput, Repo, ShinsaState } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProjectSettings } from '@/components/settings/projects.tsx';
import type { ProjectActions } from '@/lib/projects.ts';
import { findTooltipText } from '../../support/hover.ts';
import { createProject, createRepo, createShinsaState } from '../../support/state.ts';

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
  };
  return Object.assign(actions, overrides) as typeof actions;
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
    await waitFor(() => expect(screen.queryByLabelText('Name')).toBeNull());
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
});
