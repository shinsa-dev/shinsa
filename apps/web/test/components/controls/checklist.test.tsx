import { describe, expect, it, mock } from 'bun:test';
import type { ChecklistItem } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { ChecklistBlock, ItemChecklist } from '@/components/controls/checklist.tsx';
import { findTooltipText } from '../../support/hover.ts';

const ITEMS: ChecklistItem[] = [
  { key: 'tag', title: 'Tag the release', detail: 'From `main`.', command: 'git push --tags', done: true },
  { key: 'notes', title: 'Publish the notes', detail: null, command: null, done: false },
];

describe('ChecklistBlock', () => {
  it('heads the list with its title and how much is done, and ticks a row', async () => {
    const onTick = mock(() => Promise.resolve());
    const view = render(
      <TooltipProvider>
        <ChecklistBlock title='Release' items={ITEMS} onTick={onTick} />
      </TooltipProvider>
    );
    expect(view.getByText('Release')).toBeTruthy();
    expect(view.getByText('1 of 2 done')).toBeTruthy();
    expect(view.container.querySelector('[data-slot=checklist-detail]')?.textContent).toBe('From main.');
    expect(view.getByText('git push --tags')).toBeTruthy();
    const box = view.getByRole('checkbox', { name: 'Publish the notes' });
    fireEvent.click(box);
    expect(onTick).toHaveBeenCalledWith(ITEMS[1], true);
    await waitFor(() => expect(box.hasAttribute('data-disabled')).toBe(false));
  });

  it('shows nothing for an empty list', () => {
    const view = render(<ChecklistBlock title='Release' items={[]} onTick={mock()} />);
    expect(view.container.textContent).toBe('');
  });
});

describe('ItemChecklist', () => {
  it('disables a row that cannot be ticked yet and says why', async () => {
    const view = render(
      <TooltipProvider>
        <ItemChecklist
          items={ITEMS}
          onTick={mock()}
          describeBlock={(item) => (item.key === 'notes' ? 'Tick it once the tag is pushed' : null)}
        />
      </TooltipProvider>
    );
    const box = view.getByRole('checkbox', { name: 'Publish the notes' });
    expect(box.hasAttribute('data-disabled')).toBe(true);
    expect(await findTooltipText(box.parentElement as HTMLElement)).toBe('Tick it once the tag is pushed');
  });

  it('puts each row’s kind beside its title and its actions under it', () => {
    const onRun = mock();
    const view = render(
      <ItemChecklist
        items={ITEMS}
        onTick={mock()}
        meta={(item) => `Kind of ${item.key}`}
        actions={(item) =>
          item.command && (
            <button type='button' onClick={() => onRun(item.command)}>
              Run
            </button>
          )
        }
      />
    );
    expect(view.getByText('Kind of tag')).toBeTruthy();
    expect(view.getAllByRole('button', { name: 'Run' })).toHaveLength(1);
    fireEvent.click(view.getByRole('button', { name: 'Run' }));
    expect(onRun).toHaveBeenCalledWith('git push --tags');
  });

  it('shows marks that cannot be ticked when nothing ticks them', () => {
    const view = render(<ItemChecklist items={ITEMS} />);
    expect(view.queryByRole('checkbox')).toBeNull();
    expect(view.getByRole('img', { name: 'Done' })).toBeTruthy();
    expect(view.getByRole('img', { name: 'Not done' })).toBeTruthy();
    expect(view.getAllByRole('listitem')[0]?.dataset.done).toBe('true');
  });
});
