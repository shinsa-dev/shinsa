import { describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react';
import { Checkbox } from '../../src/components/checkbox';

describe('Checkbox', () => {
  it('toggles and shows its check only when ticked', () => {
    const onCheckedChange = mock();
    const view = render(<Checkbox aria-label='Viewed' checked={false} onCheckedChange={onCheckedChange} />);
    const box = view.getByRole('checkbox', { name: 'Viewed' });
    expect(box.dataset.slot).toBe('checkbox');
    expect(box.querySelector('[data-slot=icon]')).toBeNull();
    fireEvent.click(box);
    expect(onCheckedChange.mock.calls[0]?.[0]).toBe(true);
    view.rerender(<Checkbox aria-label='Viewed' checked size='sm' />);
    expect(view.getByRole('checkbox', { name: 'Viewed' }).getAttribute('aria-checked')).toBe('true');
    expect(view.getByRole('checkbox', { name: 'Viewed' }).className).toContain('size-3.5');
    expect(box.querySelector('[data-slot=icon]')).not.toBeNull();
  });

  it('fills with the accent when ticked, or, as an outline, has no fill until it is ticked', () => {
    const view = render(
      <>
        <Checkbox aria-label='Filled' checked />
        <Checkbox aria-label='Outlined' variant='outline' checked />
      </>
    );
    const filled = view.getByRole('checkbox', { name: 'Filled' }).className.split(' ');
    expect(filled).toEqual(expect.arrayContaining(['bg-background', 'data-checked:bg-primary-4']));
    const outlined = view.getByRole('checkbox', { name: 'Outlined' });
    expect(outlined.dataset.variant).toBe('outline');
    const classes = outlined.className.split(' ');
    expect(classes).toEqual(
      expect.arrayContaining(['bg-transparent', 'data-checked:border-primary-4', 'data-checked:bg-primary-4'])
    );
    expect(classes).not.toContain('bg-background');
  });
});
