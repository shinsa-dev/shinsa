import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react';
import { Input } from '../../src/components/input';

describe('Input', () => {
  it('draws its loading spinner at the field’s icon size, and hides it when idle', () => {
    const busy = render(<Input loading aria-label='Busy' />).container.querySelector('[data-slot=spinner]');
    expect(busy?.classList.contains('size-(--icon-size-md)')).toBe(true);
    expect(busy?.classList.contains('opacity-0')).toBe(false);
    const small = render(<Input loading size='sm' aria-label='Small' />).container.querySelector(
      '[data-slot=spinner]'
    );
    expect(small?.classList.contains('size-(--icon-size-sm)')).toBe(true);
    const idle = render(<Input loading={false} aria-label='Idle' />).container.querySelector(
      '[data-slot=spinner]'
    );
    expect(idle?.classList.contains('opacity-0')).toBe(true);
  });
});
