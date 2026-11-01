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

function Field() {
  const field = React.useRef<HTMLTextAreaElement>(null);
  return (
    <>
      <textarea ref={field} data-testid='field' />
      <ScrollFade targetRef={field} />
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

  it('fades a field from its measured edges alone, with a shorter fade', () => {
    const { getByTestId, unmount } = render(<Field />);
    const field = getByTestId('field');
    expect(field.hasAttribute('data-fade-static')).toBe(true);
    expect(field.style.getPropertyValue('--fade-size')).toBe('16px');
    unmount();
    expect(field.hasAttribute('data-fade-static')).toBe(false);
  });

  it('clears both fades on input once the text no longer overflows', () => {
    const { getByTestId } = render(<Field />);
    const field = getByTestId('field');
    place(field, { scrollTop: 478, scrollHeight: 638, clientHeight: 160 });
    fireEvent.scroll(field);
    expect(field.hasAttribute('data-overflow-y-start')).toBe(true);
    place(field, { scrollTop: 0, scrollHeight: 40, clientHeight: 40 });
    fireEvent.input(field);
    expect(field.hasAttribute('data-overflow-y-start')).toBe(false);
    expect(field.hasAttribute('data-overflow-y-end')).toBe(false);
  });

  it('keeps the last line clear when only the padding below it is out of view', () => {
    const { getByTestId } = render(<Field />);
    const field = getByTestId('field');
    place(field, { scrollTop: 332, scrollHeight: 497, clientHeight: 160 });
    fireEvent.input(field);
    expect(field.hasAttribute('data-overflow-y-start')).toBe(true);
    expect(field.hasAttribute('data-overflow-y-end')).toBe(false);
    place(field, { scrollTop: 300, scrollHeight: 497, clientHeight: 160 });
    fireEvent.input(field);
    expect(field.hasAttribute('data-overflow-y-end')).toBe(true);
  });
});
