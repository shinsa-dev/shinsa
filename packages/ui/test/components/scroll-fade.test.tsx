import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react';
import * as React from 'react';
import { ScrollFade } from '../../src/components/scroll-fade';

function Decorated({ seen }: { seen: string[] }) {
  const target = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    seen.push(target.current?.getAttribute('data-fade-orientation') ?? 'none');
  });
  return (
    <>
      <div ref={target} data-testid='target' />
      <ScrollFade orientation='horizontal' size={16} targetRef={target} />
    </>
  );
}

describe('ScrollFade', () => {
  it('renders its own scroller already fading, so the first paint has the fade', () => {
    const { container } = render(
      <ScrollFade orientation='both' size='2rem'>
        <div>content</div>
      </ScrollFade>
    );
    const viewport = container.querySelector('[data-slot=scroll-fade-viewport]') as HTMLElement;
    expect(viewport.classList.contains('scroll-fade')).toBe(true);
    expect(viewport.getAttribute('data-fade-orientation')).toBe('both');
    expect(viewport.style.getPropertyValue('--fade-size')).toBe('2rem');
  });

  it('decorates a target rendered before it in the same commit, and cleans up after itself', () => {
    const seen: string[] = [];
    const { getByTestId, unmount } = render(<Decorated seen={seen} />);
    const target = getByTestId('target');
    expect(seen).toEqual(['horizontal']);
    expect(target.classList.contains('scroll-fade')).toBe(true);
    expect(target.style.getPropertyValue('--fade-size')).toBe('16px');
    unmount();
    expect(target.classList.contains('scroll-fade')).toBe(false);
    expect(target.hasAttribute('data-fade-orientation')).toBe(false);
  });
});
