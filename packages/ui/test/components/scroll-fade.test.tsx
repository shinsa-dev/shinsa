import { describe, expect, it } from 'bun:test';
import { fireEvent, render } from '@testing-library/react';
import * as React from 'react';
import { ScrollFade } from '../../src/components/scroll-fade';
import { place } from '../support/layout';

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
    const mask = container.querySelector('[data-slot=scroll-fade]') as HTMLElement;
    expect(viewport.parentElement).toBe(mask);
    expect(mask.classList.contains('scroll-fade')).toBe(true);
    expect(viewport.classList.contains('scroll-fade-source')).toBe(true);
    expect(mask.hasAttribute('data-fade-scope')).toBe(true);
    expect(mask.getAttribute('data-fade-orientation')).toBe('both');
    expect(mask.style.getPropertyValue('--fade-size')).toBe('2rem');
    expect(mask.style.getPropertyValue('--fade-timeline-x')).toStartWith('--fade-x');
  });

  it('marks the edges that still hide content on the mask, from the scroller it wraps', () => {
    const { container } = render(
      <ScrollFade orientation='vertical'>
        <div>content</div>
      </ScrollFade>
    );
    const viewport = container.querySelector('[data-slot=scroll-fade-viewport]') as HTMLElement;
    const mask = container.querySelector('[data-slot=scroll-fade]') as HTMLElement;
    place(viewport, { scrollTop: 40, scrollHeight: 1000, clientHeight: 200 });
    fireEvent.scroll(viewport);
    expect(mask.hasAttribute('data-overflow-y-start')).toBe(true);
    expect(mask.hasAttribute('data-overflow-y-end')).toBe(true);
    expect(mask.hasAttribute('data-overflow-x-start')).toBe(false);
    expect(viewport.hasAttribute('data-overflow-y-start')).toBe(false);
  });

  it('decorates a target rendered before it in the same commit, and cleans up after itself', () => {
    const seen: string[] = [];
    const { getByTestId, unmount } = render(<Decorated seen={seen} />);
    const target = getByTestId('target');
    expect(seen).toEqual(['horizontal']);
    expect(target.classList.contains('scroll-fade')).toBe(true);
    expect(target.hasAttribute('data-fade-scope')).toBe(false);
    expect(target.style.getPropertyValue('--fade-size')).toBe('16px');
    unmount();
    expect(target.classList.contains('scroll-fade')).toBe(false);
    expect(target.hasAttribute('data-fade-orientation')).toBe(false);
  });
});
