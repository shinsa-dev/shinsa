import { describe, expect, it, mock } from 'bun:test';
import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../src/components/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../src/components/select';
import { flush } from '../support/layout';

function Menu(props: { open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void }) {
  return (
    <DropdownMenu {...props}>
      <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>Rename</DropdownMenuItem>
        <DropdownMenuItem variant='destructive' icon='IconTrashCan'>
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const items = [
  { value: 'low', label: 'Low' },
  { value: 'high', label: 'High', icon: 'IconPriorityHigh' as const },
];

function Priority(props: { open?: boolean; onOpenChange?: (open: boolean) => void; value?: string }) {
  return (
    <Select
      items={items}
      defaultValue={props.value ?? 'high'}
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      <SelectTrigger aria-label='Priority'>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value} icon={item.icon}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

describe('DropdownMenu', () => {
  it('opens on click and reports why', async () => {
    const onOpenChange = mock();
    render(<Menu onOpenChange={onOpenChange} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
      await flush();
    });
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeTruthy();
    expect(onOpenChange.mock.calls[0]?.[0]).toBe(true);
    expect(onOpenChange.mock.calls[0]?.[1]).toMatchObject({ reason: 'trigger-press' });
  });

  it('can start open, and marks a destructive row', async () => {
    render(<Menu defaultOpen />);
    await act(() => flush());
    expect(screen.getByRole('menuitem', { name: 'Delete' }).dataset.variant).toBe('destructive');
  });

  it('only asks when controlled', async () => {
    const onOpenChange = mock();
    render(<Menu open={false} onOpenChange={onOpenChange} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
      await flush();
    });
    expect(onOpenChange).toHaveBeenCalled();
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).toBeNull();
  });
});

describe('Select', () => {
  it('shows the selected item’s label and icon in the trigger', () => {
    render(<Priority />);
    const trigger = screen.getByRole('combobox', { name: 'Priority' });
    expect(trigger.textContent).toBe('High');
    expect(trigger.querySelectorAll('svg')).toHaveLength(2);
  });

  it('shows a value it has no item for instead of going blank', () => {
    render(<Priority value='urgent' />);
    expect(screen.getByRole('combobox', { name: 'Priority' }).textContent).toBe('urgent');
  });

  it('opens on click and reports why', async () => {
    const onOpenChange = mock();
    render(<Priority onOpenChange={onOpenChange} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('combobox', { name: 'Priority' }));
      await flush();
    });
    expect(screen.getByRole('option', { name: 'Low' })).toBeTruthy();
    expect(onOpenChange.mock.calls[0]?.[1]).toMatchObject({ reason: 'trigger-press' });
  });

  it('only asks when controlled', async () => {
    const onOpenChange = mock();
    render(<Priority open={false} onOpenChange={onOpenChange} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('combobox', { name: 'Priority' }));
      await flush();
    });
    expect(onOpenChange).toHaveBeenCalled();
    expect(screen.queryByRole('option', { name: 'Low' })).toBeNull();
  });
});
