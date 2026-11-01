import { describe, expect, it } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';
import { MachinesSection } from '@/components/home/machines.tsx';
import type { MachineChoice } from '@/lib/connection/socket.ts';
import { createMachineResources, createTaskResources } from '../../support/resources.ts';
import { createShinsaState, createTask } from '../../support/state.ts';

const state = createShinsaState({
  tasks: [createTask({ id: 'export', title: 'Retry the exports', handle: 'SW-7', stage: 'building' })],
});

function createChoice(overrides: Partial<MachineChoice>): MachineChoice {
  return { id: 'studio', name: 'Studio', current: true, state, ...overrides };
}

describe('MachinesSection', () => {
  it('shows nothing without machines, as on Shinsa for Mac', () => {
    const { container } = render(<MachinesSection state={state} machines={[]} />);
    expect(container.textContent).toBe('');
  });

  it('shows each machine’s use, and its open tasks’ use once opened', () => {
    const studio = createChoice({
      resources: createMachineResources({ tasks: [createTaskResources({ taskId: 'export' })] }),
    });
    const box = createChoice({ id: 'box', name: 'Build box', resources: null });
    render(<MachinesSection state={state} machines={[studio, box]} />);
    expect(screen.getByText('CPU 20% · Memory 8 of 32 GB · 120 GB free')).toBeTruthy();
    expect(screen.getByText('No reading yet.')).toBeTruthy();
    expect(screen.queryByText('Retry the exports')).toBeNull();

    const row = screen.getByRole('button', { name: /^Studio/ });
    fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Agent 4%, 0.5 GB')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Retry the exports/ }));
    expect(location.pathname).toBe('/tasks/SW-7');

    fireEvent.click(screen.getByRole('button', { name: /^Build box/ }));
    expect(screen.getByText('No open task is using this machine.')).toBeTruthy();
    fireEvent.click(row);
    expect(screen.queryByText('Retry the exports')).toBeNull();
  });
});
