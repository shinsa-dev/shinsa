import { describe, expect, it, mock } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PolicySettings } from '@/components/settings/policies.tsx';
import type { MachineChoice } from '@/lib/connection/socket.ts';
import type { PolicyActions } from '@/lib/remote/policies.ts';

function machine(id: string, name: string, policies: string[]): MachineChoice {
  return {
    id,
    name,
    current: false,
    state: { tasks: {}, projects: {}, settings: { placementPolicies: policies } },
  };
}

function renderPolicies(machines: MachineChoice[]) {
  const write = mock<PolicyActions['write']>(() => Promise.resolve(true));
  render(
    <TooltipProvider>
      <PolicySettings machines={machines} actions={{ write }} />
    </TooltipProvider>
  );
  return write;
}

describe('Settings → Policies', () => {
  it('shows nothing without machines, and what policies are for while there are none', () => {
    const { container } = render(<PolicySettings machines={[]} />);
    expect(container.textContent).toBe('');
    renderPolicies([machine('studio', 'Studio', [])]);
    expect(screen.getByText(/A new task whose request names a word of a policy/)).toBeTruthy();
  });

  it('adds a policy for the machine picked, after refusing an empty one', async () => {
    const write = renderPolicies([machine('studio', 'Studio', []), machine('server', 'Server', [])]);
    fireEvent.click(screen.getByRole('button', { name: 'New policy' }));
    fireEvent.submit(screen.getByRole('textbox', { name: 'The policy' }).closest('form') as HTMLFormElement);
    expect(await screen.findByText('Write the words a request names to run on this machine.')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'The policy' }), { target: { value: 'benchmark' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add policy' }));
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith([{ machineId: 'studio', policies: ['benchmark'] }], 'Policy added.')
    );
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'The policy' })).toBeNull());
  });

  it('lists each machine’s policies, edits one in place and removes another', async () => {
    const write = renderPolicies([
      machine('studio', 'Studio', ['iOS, simulator', 'Xcode']),
      machine('server', 'Server', []),
    ]);
    expect(screen.getByText('2 of 20')).toBeTruthy();
    expect(screen.getByText('No policies for this machine yet.')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1] as HTMLElement);
    const field = screen.getByRole('textbox', { name: 'The policy' });
    fireEvent.change(field, { target: { value: 'Xcode, Swift' } });
    fireEvent.keyDown(field, { key: 'Enter', metaKey: true });
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith(
        [{ machineId: 'studio', policies: ['iOS, simulator', 'Xcode, Swift'] }],
        'Policy saved.'
      )
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0] as HTMLElement);
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith([{ machineId: 'studio', policies: ['Xcode'] }], 'Policy removed.')
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0] as HTMLElement);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'The policy' }), { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'The policy' })).toBeNull();
  });
});
