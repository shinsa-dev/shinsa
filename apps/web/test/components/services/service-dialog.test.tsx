import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { ServiceSuggestion, TerminalPlace } from '@shinsa/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AddServicesDialog } from '@/components/services/service-dialog.tsx';
import type { ServiceInput } from '@/lib/terminal/services.ts';
import { createProject } from '../../support/state.ts';

const ROOT = '/code/shop';

const PLACES: TerminalPlace[] = [{ path: ROOT, label: 'shop', kind: 'repository', taskId: null }];

const SUGGESTIONS: ServiceSuggestion[] = [
  { name: 'api', cwd: `${ROOT}/apps/api`, command: 'bun run dev', source: 'package', recommended: true },
  { name: 'web', cwd: `${ROOT}/apps/web`, command: 'bun run dev', source: 'package', recommended: true },
  { name: 'all', cwd: ROOT, command: 'bun run dev', source: 'package', recommended: false },
];

const realFetch = globalThis.fetch;

function serveSuggestions(suggestions: ServiceSuggestion[]) {
  globalThis.fetch = mock(async () => Response.json({ suggestions })) as unknown as typeof fetch;
}

function renderDialog() {
  const added: ServiceInput[][] = [];
  const addedOne: ServiceInput[] = [];
  render(
    <AddServicesDialog
      control={{ open: true, onOpenChange: () => undefined, onOpenChangeComplete: () => undefined }}
      projects={[createProject({ id: 'p1', name: 'Shop', color: 'blue' })]}
      projectId='p1'
      home='/home'
      listPlaces={() => PLACES}
      onAdd={async (_projectId, inputs) => {
        added.push(inputs);
        return true;
      }}
      onAddOne={async (_projectId, input) => {
        addedOne.push(input);
        return true;
      }}
    />
  );
  return { added, addedOne };
}

beforeEach(() => serveSuggestions(SUGGESTIONS));

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('Add services', () => {
  it('lists what was found with its command and folder, the recommended ones ticked, and adds the ticked ones', async () => {
    const { added } = renderDialog();
    const add = await screen.findByRole('button', { name: 'Add 2 services' });
    expect(screen.getByRole('group', { name: 'Services found' }).textContent).toContain(
      'bun run dev in shop/apps/api'
    );
    expect(screen.getByRole('checkbox', { name: 'Add api' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('checkbox', { name: 'Add all' }).getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByText('web'));
    expect(screen.getByRole('button', { name: 'Add 1 service' })).toBe(add);
    fireEvent.click(add);
    await waitFor(() => expect(added).toHaveLength(1));
    expect(added).toEqual([[{ name: 'api', cwd: `${ROOT}/apps/api`, command: 'bun run dev', env: {} }]]);
  });

  it('keeps the form for a service of your own under Advanced, with the folder picked from the project', async () => {
    const { addedOne } = renderDialog();
    await screen.findByRole('button', { name: 'Add 2 services' });
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    expect(screen.getByRole('combobox', { name: 'Folder' }).textContent).toBe('shop');
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'worker' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Command' }), {
      target: { value: 'bun worker.ts' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add service' }));
    await waitFor(() => expect(addedOne).toHaveLength(1));
    expect(addedOne).toEqual([{ name: 'worker', cwd: ROOT, command: 'bun worker.ts', env: {} }]);
  });

  it('opens the form at once when nothing was found', async () => {
    serveSuggestions([]);
    renderDialog();
    expect(await screen.findByText('No services found in Shop.')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Advanced' })).toBeNull();
  });
});
