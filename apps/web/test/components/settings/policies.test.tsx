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
    state: { tasks: {}, projects: {}, repos: {}, settings: { placementPolicies: policies } },
  };
}

function renderPolicies(machines: MachineChoice[], unreachable: { id: string; name: string }[] = []) {
  const write = mock<PolicyActions['write']>(() => Promise.resolve(true));
  render(
    <TooltipProvider>
      <PolicySettings machines={machines} unreachable={unreachable} actions={{ write }} />
    </TooltipProvider>
  );
  return write;
}

describe('Settings → Routing policies', () => {
  it('shows nothing without machines, and what policies are for while there are none', () => {
    const { container } = render(<PolicySettings machines={[]} />);
    expect(container.textContent).toBe('');
    renderPolicies([machine('studio', 'Studio', [])]);
    expect(screen.getByText(/Shinsa reads every policy with the request and picks the machine/)).toBeTruthy();
  });

  it('adds a policy for the machine picked, after refusing an empty one', async () => {
    const write = renderPolicies(
      [machine('studio', 'Studio', []), machine('server', 'Server', [])],
      [{ id: 'laptop', name: 'Laptop' }]
    );
    fireEvent.click(screen.getByRole('button', { name: 'New routing policy' }));
    fireEvent.click(screen.getByRole('combobox', { name: 'Runs on' }));
    const laptop = await screen.findByRole('option', { name: /Laptop/ });
    expect(laptop.textContent).toContain('Add this device on Laptop first');
    expect(laptop.getAttribute('aria-disabled')).toBe('true');
    fireEvent.keyDown(laptop, { key: 'Escape' });
    fireEvent.submit(
      screen.getByRole('textbox', { name: 'The routing policy' }).closest('form') as HTMLFormElement
    );
    expect(await screen.findByText('Write what runs on this machine.')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'The routing policy' }), {
      target: { value: 'benchmark' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add routing policy' }));
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith(
        [{ machineId: 'studio', policies: ['benchmark'] }],
        'Routing policy added.'
      )
    );
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'The routing policy' })).toBeNull());
  });

  it('lists each machine’s policies, edits one in place and removes another', async () => {
    const write = renderPolicies([
      machine('studio', 'Studio', ['iOS, simulator', 'Xcode']),
      machine('server', 'Server', []),
    ]);
    expect(screen.getByText('2 of 20')).toBeTruthy();
    expect(screen.getByText('No routing policies for this machine yet.')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1] as HTMLElement);
    const field = screen.getByRole('textbox', { name: 'The routing policy' });
    fireEvent.change(field, { target: { value: 'Xcode, Swift' } });
    fireEvent.keyDown(field, { key: 'Enter', metaKey: true });
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith(
        [{ machineId: 'studio', policies: ['iOS, simulator', 'Xcode, Swift'] }],
        'Routing policy saved.'
      )
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0] as HTMLElement);
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith(
        [{ machineId: 'studio', policies: ['Xcode'] }],
        'Routing policy removed.'
      )
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0] as HTMLElement);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'The routing policy' }), { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'The routing policy' })).toBeNull();
  });
});
