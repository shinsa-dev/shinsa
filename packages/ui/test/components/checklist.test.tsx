import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react';
import {
  Checklist,
  ChecklistActions,
  ChecklistDetail,
  ChecklistHeader,
  ChecklistItem,
  ChecklistMark,
  ChecklistTitle,
} from '../../src/components/checklist';

describe('Checklist', () => {
  it('lays out each row with its check beside its title, detail and actions', () => {
    const view = render(
      <>
        <ChecklistHeader title='Release' progress='1 of 2 done' />
        <Checklist>
          <ChecklistItem done check={<ChecklistMark done />}>
            <ChecklistTitle meta='Config'>Set the region</ChecklistTitle>
            <ChecklistDetail>eu-west-1</ChecklistDetail>
            <ChecklistActions>
              <button type='button'>Run</button>
            </ChecklistActions>
          </ChecklistItem>
          <ChecklistItem done={false} check={<ChecklistMark done={false} label='Open' />}>
            <ChecklistTitle>Rotate the key</ChecklistTitle>
          </ChecklistItem>
        </Checklist>
      </>
    );
    expect(view.getByText('Release')).toBeTruthy();
    expect(view.getByText('1 of 2 done')).toBeTruthy();
    const rows = view.getAllByRole('listitem');
    expect(rows.map((row) => row.dataset.done)).toEqual(['true', undefined]);
    expect(rows[0]?.querySelector('[data-slot=checklist-check] [data-slot=checklist-mark]')).not.toBeNull();
    expect(view.getByText('Config')).toBeTruthy();
    expect(view.getByText('eu-west-1').dataset.slot).toBe('checklist-detail');
    expect(view.getByRole('button', { name: 'Run' }).parentElement?.dataset.slot).toBe('checklist-actions');
    expect(rows[1]?.querySelector('[data-slot=checklist-title]')?.childElementCount).toBe(1);
  });

  it('draws a read-only mark with a check only when done, named for its state', () => {
    const view = render(
      <>
        <ChecklistMark done />
        <ChecklistMark done={false} />
      </>
    );
    const done = view.getByRole('img', { name: 'Done' });
    expect(done.dataset.done).toBe('true');
    expect(done.querySelector('[data-slot=icon]')).not.toBeNull();
    expect(view.getByRole('img', { name: 'Not done' }).querySelector('[data-slot=icon]')).toBeNull();
  });

  it('leaves the progress out of a header without one', () => {
    const view = render(<ChecklistHeader title='Release' />);
    expect(view.container.querySelectorAll('span')).toHaveLength(1);
  });
});
