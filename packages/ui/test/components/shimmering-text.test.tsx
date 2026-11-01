import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react';
import { ShimmeringText } from '../../src/components/shimmering-text';

describe('ShimmeringText', () => {
  it('renders the text once for every reader and the sweep as a hidden copy, with no span per character', () => {
    const view = render(<ShimmeringText text='Reading app.tsx' />);
    const line = view.container.querySelector('[data-slot="shimmering-text"]');
    expect(line?.querySelectorAll('span')).toHaveLength(3);
    expect(line?.querySelector('[aria-hidden]')?.textContent).toBe('Reading app.tsx');
    expect(view.getByText('Reading app.tsx', { ignore: '[aria-hidden] *' })).toBe(line as HTMLElement);
  });

  it('times the sweep by the length of the text', () => {
    const view = render(<ShimmeringText text={'x'.repeat(60)} />);
    const line = view.container.querySelector<HTMLElement>('[data-slot="shimmering-text"]');
    expect(line?.style.getPropertyValue('--shimmer-duration')).toBe('4.545s');
  });

  it('holds still with no sweep when paused', () => {
    const view = render(<ShimmeringText text='Waiting' paused />);
    expect(view.container.querySelector('.shimmer-window')).toBeNull();
    expect(view.container.textContent).toBe('Waiting');
  });
});
