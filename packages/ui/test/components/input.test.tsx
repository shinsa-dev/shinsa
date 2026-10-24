import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react';
import { Input } from '../../src/components/input';

describe('Input', () => {
  it('draws its loading spinner a step under its text, like any icon, and hides it when idle', () => {
    const busy = render(<Input loading aria-label='Busy' />).container.querySelector('[data-slot=spinner]');
    expect(busy?.classList.contains('opacity-(--icon-alpha)')).toBe(true);
    const idle = render(<Input loading={false} aria-label='Idle' />).container.querySelector(
      '[data-slot=spinner]'
    );
    expect(idle?.classList.contains('opacity-0')).toBe(true);
    expect(idle?.classList.contains('opacity-(--icon-alpha)')).toBe(false);
  });
});
