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
});
