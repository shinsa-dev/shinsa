import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FocusMenu } from '@/components/focus/menu.tsx';
import { listSentCommands, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createProject, createShinsaState } from '../../support/state.ts';

const PROJECTS = [createProject({ id: 'work', name: 'Work' }), createProject({ id: 'home', name: 'Home' })];

function renderFocus(projectId: string | null) {
  const state = createShinsaState({
    projects: PROJECTS,
    patch: { focus: { projectId, teamId: null, until: null } },
  });
  render(<FocusMenu state={state} />);
  fireEvent.click(screen.getByRole('button', { name: /^Focus/ }));
}

function checked() {
  return screen
    .getAllByRole('menuitemradio')
    .filter((item) => item.getAttribute('aria-checked') === 'true')
    .map((item) => item.textContent);
}

beforeEach(startFakeServer);

afterEach(stopFakeServer);

describe('the Focus menu', () => {
  it('checks the project in focus', async () => {
    renderFocus('home');
    await screen.findByRole('menu');
    expect(checked()).toEqual(['Home']);
  });

  it('checks All work when nothing is in focus', async () => {
    renderFocus(null);
    await screen.findByRole('menu');
    expect(checked()).toEqual(['All work']);
  });

  it('focuses the project you pick until you change it', async () => {
    renderFocus(null);
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Work' }));
    await waitFor(() =>
      expect(listSentCommands()).toEqual([{ type: 'focus.change', projectId: 'work', until: null }])
    );
  });
});
