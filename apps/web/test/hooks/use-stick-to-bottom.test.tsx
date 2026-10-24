import { afterEach, beforeEach, describe, expect, it, jest, mock } from 'bun:test';
import { act, fireEvent, render } from '@testing-library/react';
import { useStickToBottom } from '@/hooks/use-stick-to-bottom.ts';

const observers: { callback: () => void; disconnected: boolean }[] = [];
const frames = new Map<number, () => void>();
const original = {
  ResizeObserver: globalThis.ResizeObserver,
  requestAnimationFrame: globalThis.requestAnimationFrame,
  cancelAnimationFrame: globalThis.cancelAnimationFrame,
  scrollIntoView: HTMLElement.prototype.scrollIntoView,
};
const scrolledIntoView: Element[] = [];

class FakeResizeObserver {
  entry: { callback: () => void; disconnected: boolean };
  constructor(callback: () => void) {
    this.entry = { callback, disconnected: false };
    observers.push(this.entry);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    this.entry.disconnected = true;
  }
}

beforeEach(() => {
  observers.length = 0;
  frames.clear();
  scrolledIntoView.length = 0;
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
  let next = 0;
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
    next += 1;
    frames.set(next, () => callback(0));
    return next;
  };
  globalThis.cancelAnimationFrame = (id: number) => {
    frames.delete(id);
  };
  HTMLElement.prototype.scrollIntoView = function scrollIntoView() {
    scrolledIntoView.push(this);
  };
});

afterEach(() => {
  globalThis.ResizeObserver = original.ResizeObserver;
  globalThis.requestAnimationFrame = original.requestAnimationFrame;
  globalThis.cancelAnimationFrame = original.cancelAnimationFrame;
  HTMLElement.prototype.scrollIntoView = original.scrollIntoView;
  jest.useRealTimers();
});

function runFrames() {
  act(() => {
    for (const [id, frame] of [...frames]) {
      frames.delete(id);
      frame();
    }
  });
}

function resize() {
  act(() => {
    for (const observer of observers) if (!observer.disconnected) observer.callback();
  });
}

function Chat({ focusRunId, runs = ['a', 'b'] }: { focusRunId: string | null; runs?: string[] }) {
  const { scroller, content, detached, onScroll, jumpToLatest } = useStickToBottom(focusRunId);
  return (
    <div>
      <div ref={scroller} data-testid='scroller' onScroll={onScroll}>
        <div ref={content}>
          {runs.map((id) => (
            <section key={id} id={`run-${id}`} data-testid={`run-${id}`}>
              <p data-message data-testid={`${id}-first`} />
              <p data-message data-testid={`${id}-last`} />
            </section>
          ))}
        </div>
      </div>
      {detached && (
        <button type='button' onClick={jumpToLatest}>
          Jump to latest
        </button>
      )}
    </div>
  );
}

function setup(focusRunId: string | null, size = { scrollHeight: 1000, clientHeight: 200 }) {
  const view = render(<Chat focusRunId={focusRunId} />);
  const scroller = view.getByTestId('scroller');
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: size.scrollHeight });
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: size.clientHeight });
  const scrollTo = mock((options: ScrollToOptions) => {
    scroller.scrollTop = options.top ?? 0;
  });
  scroller.scrollTo = scrollTo as unknown as typeof scroller.scrollTo;
  function scrollAt(top: number) {
    scroller.scrollTop = top;
    fireEvent.scroll(scroller);
  }
  return { ...view, scroller, scrollTo, scrollAt };
}

describe('useStickToBottom', () => {
  it('keeps the newest message in view as the transcript grows', () => {
    const { scroller } = setup(null);
    resize();
    expect(scroller.scrollTop).toBe(1000);
  });

  it('stops following once you scroll up, and offers to jump back', () => {
    const { scroller, scrollAt, queryByText } = setup(null);
    scrollAt(800);
    expect(queryByText('Jump to latest')).toBeNull();
    scrollAt(400);
    expect(queryByText('Jump to latest')).not.toBeNull();
    resize();
    expect(scroller.scrollTop).toBe(400);
  });

  it('keeps following while you scroll down near the bottom', () => {
    const { scrollAt, queryByText } = setup(null);
    scrollAt(400);
    scrollAt(790);
    expect(queryByText('Jump to latest')).toBeNull();
  });

  it('does not offer the jump when the view moves down on its own', () => {
    const { scrollAt, queryByText } = setup(null);
    scrollAt(100);
    expect(queryByText('Jump to latest')).toBeNull();
  });

  it('jumps back to the latest message and follows again', () => {
    const { scroller, scrollTo, scrollAt, getByText, queryByText } = setup(null);
    scrollAt(800);
    scrollAt(400);
    fireEvent.click(getByText('Jump to latest'));
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'smooth' });
    scrollAt(1000);
    expect(queryByText('Jump to latest')).toBeNull();
    scroller.scrollTop = 0;
    resize();
    expect(scroller.scrollTop).toBe(1000);
  });

  it('scrolls a linked run into view and washes it until the highlight fades', () => {
    jest.useFakeTimers();
    const { getByTestId } = setup('a');
    runFrames();
    expect(scrolledIntoView).toEqual([getByTestId('a-last')]);
    expect(getByTestId('run-a').hasAttribute('data-focused')).toBe(true);
    act(() => {
      jest.advanceTimersByTime(2_100);
    });
    expect(getByTestId('run-a').hasAttribute('data-focused')).toBe(false);
  });

  it('holds a linked run in view while the transcript loads, then stops following', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(1_000_000));
    const { scroller, getByTestId } = setup('b');
    resize();
    expect(scrolledIntoView).toEqual([getByTestId('b-last')]);
    expect(scroller.scrollTop).toBe(0);
    jest.setSystemTime(new Date(1_002_000));
    resize();
    expect(scrolledIntoView).toHaveLength(1);
    expect(scroller.scrollTop).toBe(0);
  });

  it('scrolls to a run without messages and ignores a run that is not on screen', () => {
    const view = render(<Chat focusRunId='empty' runs={[]} />);
    runFrames();
    expect(scrolledIntoView).toEqual([]);
    view.rerender(<Chat focusRunId='a' runs={['a']} />);
    view.getByTestId('a-first').removeAttribute('data-message');
    view.getByTestId('a-last').removeAttribute('data-message');
    runFrames();
    expect(scrolledIntoView).toEqual([view.getByTestId('run-a')]);
  });

  it('moves the highlight when you open another run before the first one fades', () => {
    const view = render(<Chat focusRunId='a' />);
    runFrames();
    expect(view.getByTestId('run-a').hasAttribute('data-focused')).toBe(true);
    view.rerender(<Chat focusRunId='b' />);
    runFrames();
    expect(view.getByTestId('run-b').hasAttribute('data-focused')).toBe(true);
    expect(view.getByTestId('run-a').hasAttribute('data-focused')).toBe(false);
  });

  it('cancels a pending reveal and stops observing when the chat closes', () => {
    const view = render(<Chat focusRunId='a' />);
    view.unmount();
    expect(frames.size).toBe(0);
    expect(observers.every((observer) => observer.disconnected)).toBe(true);
  });
});
