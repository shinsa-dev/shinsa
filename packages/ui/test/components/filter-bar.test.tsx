import { describe, expect, it, mock } from 'bun:test';
import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  FilterBar,
  FilterChip,
  FilterClear,
  type FilterField,
  FilterMenu,
} from '../../src/components/filter-bar';
import { flush } from '../support/layout';

const STATUS: FilterField = {
  key: 'status',
  label: 'Status',
  icon: 'IconListBullets',
  options: [
    { value: 'open', label: 'Open', icon: 'IconPriorityHigh', count: 4 },
    { value: 'review', label: 'Review', count: 2 },
    { value: 'done', label: 'Done', count: 1 },
  ],
};

describe('FilterChip', () => {
  it('names one value with "is", and several with "is any of" and a count past two', () => {
    const { rerender } = render(
      <FilterChip field={STATUS} values={['open']} onToggle={mock()} onRemove={mock()} />
    );
    expect(screen.getByText('is')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Change the status filter' }).textContent).toBe('Open');
    rerender(
      <FilterChip
        field={STATUS}
        values={['open', 'review', 'done', 'gone']}
        onToggle={mock()}
        onRemove={mock()}
      />
    );
    expect(screen.getByText('is any of')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Change the status filter' }).textContent).toBe(
      'Open, Review +2'
    );
  });

  it('toggles a value from its menu and removes the whole field from its cross', async () => {
    const onToggle = mock();
    const onRemove = mock();
    render(<FilterChip field={STATUS} values={['open']} onToggle={onToggle} onRemove={onRemove} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Change the status filter' }));
      await flush();
    });
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Review 2' }));
    expect(onToggle).toHaveBeenCalledWith('status', 'review');
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await act(flush);
    fireEvent.click(screen.getByRole('button', { name: 'Remove the status filter' }));
    expect(onRemove).toHaveBeenCalled();
  });
});

describe('FilterMenu', () => {
  it('says how many fields are on, and clears them', async () => {
    const onClear = mock();
    render(
      <FilterMenu fields={[STATUS]} selected={{ status: ['done'] }} onToggle={mock()} onClear={onClear} />
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Filter, 1 on' }));
      await flush();
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear filters' }));
    expect(onClear).toHaveBeenCalled();
  });

  it('is a plus button in a filter bar, with no clear item', async () => {
    render(
      <FilterBar>
        <FilterMenu variant='add' fields={[STATUS]} selected={{ status: [] }} onToggle={mock()} />
        <FilterClear onClick={mock()} />
      </FilterBar>
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add a filter' }));
      await flush();
    });
    expect(screen.getByRole('menuitem', { name: 'Status' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Clear filters' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeTruthy();
  });

  it('closes the plus menu once a value is picked, and keeps the filter menu open', async () => {
    const onToggle = mock();
    render(
      <FilterBar>
        <FilterMenu variant='add' fields={[STATUS]} selected={{ status: [] }} onToggle={onToggle} />
        <FilterMenu fields={[STATUS]} selected={{ status: [] }} onToggle={onToggle} />
      </FilterBar>
    );
    async function pick(trigger: string) {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: trigger }));
        await flush();
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('menuitem', { name: 'Status' }));
        await flush();
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Review 2' }));
        await flush();
      });
    }
    await pick('Add a filter');
    expect(onToggle).toHaveBeenCalledWith('status', 'review');
    expect(screen.queryByRole('menu')).toBeNull();
    await pick('Filter');
    expect(screen.getAllByRole('menu').length).toBeGreaterThan(0);
  });

  it('cannot open with nothing to filter', () => {
    render(<FilterMenu fields={[]} selected={{}} onToggle={mock()} />);
    expect((screen.getByRole('button', { name: 'Filter' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
