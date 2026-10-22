import { describe, expect, it, mock } from 'bun:test';
import { act, fireEvent, render } from '@testing-library/react';
import * as React from 'react';
import { ScrollArea } from '../../src/components/scroll-area';
import { resolveDragScrollTop, resolveThumb, resolveTrackScrollTop } from '../../src/lib/scroll';
import { flush, place } from '../support/layout';

function setup(props: Partial<React.ComponentProps<typeof ScrollArea>> = {}) {
  const viewport = React.createRef<HTMLDivElement>();
  const view = render(
    <ScrollArea viewportRef={viewport} {...props}>
      <div>content</div>
    </ScrollArea>
  );
  const element = viewport.current as HTMLDivElement;
  const track = view.container.querySelector('[data-slot=scroll-area-scrollbar]') as HTMLElement;
  const thumb = view.container.querySelector('[data-slot=scroll-area-thumb]') as HTMLElement;
  return { view, viewport: element, track, thumb };
}

describe('ScrollArea', () => {
  it('hides the scrollbar while nothing scrolls', () => {
    const { track } = setup();
    expect(track.hasAttribute('data-hidden')).toBe(true);
  });

  it('places the thumb and the edge fades from the scroll position', () => {
    const onScroll = mock();
    const { viewport, track, thumb } = setup({ onScroll });
    place(viewport, { scrollTop: 396, scrollHeight: 1000, clientHeight: 208 });
    fireEvent.scroll(viewport);

    const geometry = resolveThumb({ scrollTop: 396, scrollHeight: 1000, clientHeight: 208 })!;
    expect(track.hasAttribute('data-hidden')).toBe(false);
    expect(track.hasAttribute('data-scrolling')).toBe(true);
    expect(thumb.style.height).toBe(`${geometry.size}px`);
    expect(thumb.style.transform).toBe(`translate3d(0, ${geometry.offset}px, 0)`);
    expect(viewport.hasAttribute('data-overflow-y-start')).toBe(true);
    expect(viewport.hasAttribute('data-overflow-y-end')).toBe(true);
    expect(onScroll).toHaveBeenCalledTimes(1);
  });

  it('leaves the edges alone without fades', () => {
    const { viewport } = setup({ fade: false });
    place(viewport, { scrollTop: 50, scrollHeight: 1000, clientHeight: 208 });
    fireEvent.scroll(viewport);
    expect(viewport.hasAttribute('data-overflow-y-start')).toBe(false);
    expect(viewport.className).not.toContain('scroll-fade');
  });

  it('hides the scrollbar again a moment after scrolling stops', async () => {
    const { viewport, track } = setup();
    place(viewport, { scrollTop: 10, scrollHeight: 1000, clientHeight: 208 });
    fireEvent.scroll(viewport);
    await act(() => flush(750));
    expect(track.hasAttribute('data-scrolling')).toBe(false);
  });

  it('scrolls by dragging the thumb, and holds the scrollbar open while dragging', async () => {
    const { viewport, track, thumb } = setup();
    const metrics = { scrollTop: 0, scrollHeight: 1000, clientHeight: 208 };
    place(viewport, metrics);
    let scrollTop = 0;
    Object.defineProperty(viewport, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    });

    fireEvent.pointerMove(thumb, { clientY: 30 });
    expect(scrollTop).toBe(0);

    fireEvent.pointerDown(thumb, { clientY: 10, pointerId: 1 });
    expect(track.hasAttribute('data-dragging')).toBe(true);
    fireEvent.pointerMove(thumb, { clientY: 30, pointerId: 1 });
    expect(scrollTop).toBeCloseTo(resolveDragScrollTop(metrics, 0, 20));

    fireEvent.scroll(viewport);
    await act(() => flush(750));
    expect(track.hasAttribute('data-scrolling')).toBe(true);

    fireEvent.pointerUp(thumb, { pointerId: 1 });
    expect(track.hasAttribute('data-dragging')).toBe(false);
  });

  it('jumps to a press on the bare track, centring the thumb there', () => {
    const { viewport, track, thumb } = setup();
    const metrics = { scrollTop: 0, scrollHeight: 1000, clientHeight: 208 };
    place(viewport, metrics);
    const scrollTo = mock();
    viewport.scrollTo = scrollTo as unknown as typeof viewport.scrollTo;

    fireEvent.pointerDown(thumb, { clientY: 5 });
    fireEvent.pointerDown(track, { clientY: 150 });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ top: resolveTrackScrollTop(metrics, 150), behavior: 'smooth' });
  });

  it('hands the viewport to a callback ref too', () => {
    const seen: (HTMLDivElement | null)[] = [];
    const view = render(
      <ScrollArea
        viewportRef={(node) => {
          seen.push(node);
        }}
      >
        content
      </ScrollArea>
    );
    expect(seen[0]?.dataset.slot).toBe('scroll-area-viewport');
    view.unmount();
    expect(seen.at(-1)).toBeNull();
  });
});
