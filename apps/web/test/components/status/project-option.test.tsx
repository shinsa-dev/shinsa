import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
} from '@shinsa/ui/components/dropdown-menu';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen } from '@testing-library/react';
import { SelectField } from '@/components/controls/select-field.tsx';
import { FocusMenu, ProjectMenuTrigger, ProjectRadioItems } from '@/components/focus/menu.tsx';
import { NewTaskForm } from '@/components/home/new-task-form.tsx';
import { AddServicesDialog } from '@/components/services/service-dialog.tsx';
import { pushState, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createProject, createShinsaState } from '../../support/state.ts';

const PROJECTS = [
  createProject({ id: 'p1', name: 'Superwall', color: 'blue' }),
  createProject({ id: 'p2', name: 'Basket', color: 'green' }),
];

const realFetch = globalThis.fetch;

function expectEveryDot(rows: HTMLElement[], colors: Record<string, string>) {
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    const dot = row.querySelector('[data-project-dot]');
    expect({ row: row.textContent, dot: dot?.getAttribute('data-project-dot') ?? null }).toEqual({
      row: row.textContent,
      dot: colors[row.textContent ?? ''] ?? null,
    });
  }
}

const COLORS: Record<string, string> = { Superwall: 'blue', Basket: 'green', 'All work': 'gray' };

beforeEach(() => {
  startFakeServer();
  globalThis.fetch = mock(async () => Response.json({ suggestions: [] })) as unknown as typeof fetch;
});

afterEach(() => {
  stopFakeServer();
  globalThis.fetch = realFetch;
});

describe('every project picker shows each project’s dot', () => {
  it('in the Focus menu and the Terminal page’s picker', async () => {
    render(<FocusMenu state={createShinsaState({ projects: PROJECTS })} />);
    fireEvent.click(screen.getByRole('button', { name: /^Focus/ }));
    expectEveryDot(await screen.findAllByRole('menuitemradio'), COLORS);
  });

  it('in the radio rows a project menu shares, and its trigger', async () => {
    render(
      <DropdownMenu>
        <ProjectMenuTrigger color='green' value='Basket' compact />
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value='p2'>
            <ProjectRadioItems projects={PROJECTS} />
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );
    const trigger = screen.getByRole('button', { name: /Basket/ });
    expect(trigger.querySelector('[data-project-dot]')?.getAttribute('data-project-dot')).toBe('green');
    fireEvent.click(trigger);
    expectEveryDot(await screen.findAllByRole('menuitemradio'), COLORS);
  });

  it('in a select of projects, trigger and options', async () => {
    render(
      <SelectField
        label='Project'
        items={PROJECTS.map((project) => ({ value: project.id, label: project.name, dot: project.color }))}
        value='p1'
        onValueChange={() => undefined}
      />
    );
    const trigger = screen.getByRole('combobox', { name: 'Project' });
    expect(trigger.querySelector('[data-project-dot]')?.getAttribute('data-project-dot')).toBe('blue');
    fireEvent.click(trigger);
    expectEveryDot(await screen.findAllByRole('option'), COLORS);
  });

  it('in the new task composer', async () => {
    pushState(createShinsaState({ projects: PROJECTS }));
    render(
      <TooltipProvider>
        <NewTaskForm />
      </TooltipProvider>
    );
    fireEvent.click(screen.getByRole('combobox', { name: 'Project' }));
    expectEveryDot(await screen.findAllByRole('option'), { ...COLORS, 'No project': 'gray' });
  });

  it('in the Add services dialog', async () => {
    render(
      <AddServicesDialog
        control={{ open: true, onOpenChange: () => undefined, onOpenChangeComplete: () => undefined }}
        projects={PROJECTS}
        projectId='p1'
        home='/home'
        listPlaces={() => []}
        onAdd={async () => true}
        onAddOne={async () => true}
      />
    );
    await screen.findByText('No services found in Superwall.');
    const trigger = screen.getByRole('combobox', { name: 'Project' });
    expect(trigger.querySelector('[data-project-dot]')?.getAttribute('data-project-dot')).toBe('blue');
    fireEvent.click(trigger);
    expectEveryDot(await screen.findAllByRole('option'), COLORS);
  });
});
