import { afterEach, describe, expect, it } from 'bun:test';
import { act, render } from '@testing-library/react';
import { useNearViewport } from '@/hooks/use-near-viewport.ts';
import { FakeIntersectionObserver, installIntersectionObserver } from '../support/intersection.ts';

let restore = () => {};

afterEach(() => restore());

function Probe() {
  const { near, ref } = useNearViewport<HTMLDivElement>();
  return <div ref={ref} data-near={near} />;
}

function nearness(container: HTMLElement) {
  return container.querySelector('div')?.dataset.near;
}

describe('useNearViewport', () => {
  it('turns true once the element comes within the margin, and stops watching', () => {
    restore = installIntersectionObserver();
    const { container } = render(<Probe />);
    expect(nearness(container)).toBe('false');
    const [observer] = FakeIntersectionObserver.observers;
    expect(observer?.observed).toEqual([container.firstElementChild as Element]);
    expect(observer?.options?.rootMargin).toBe('800px');
    act(() => FakeIntersectionObserver.report(false));
    expect(nearness(container)).toBe('false');
    act(() => FakeIntersectionObserver.report(true));
    expect(nearness(container)).toBe('true');
    expect(observer?.disconnected).toBe(true);
  });

  it('stops watching when the element goes away', () => {
    restore = installIntersectionObserver();
    const { unmount } = render(<Probe />);
    unmount();
    expect(FakeIntersectionObserver.observers.every((observer) => observer.disconnected)).toBe(true);
  });

  it('counts as near where the browser cannot watch', () => {
    const real = globalThis.IntersectionObserver;
    restore = () => {
      globalThis.IntersectionObserver = real;
    };
    globalThis.IntersectionObserver = undefined as unknown as typeof IntersectionObserver;
    const { container } = render(<Probe />);
    expect(nearness(container)).toBe('true');
  });
});
