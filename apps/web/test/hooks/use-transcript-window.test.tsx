import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, fireEvent, render } from '@testing-library/react';
import * as React from 'react';
import { useTranscriptWindow } from '@/hooks/use-transcript-window.ts';
import { GROW_BLOCKS, INITIAL_BLOCKS } from '@/lib/chat/window.ts';

const frames: (() => void)[] = [];
const browser = { anchoring: false };
const original = {
  requestAnimationFrame: globalThis.requestAnimationFrame,
  CSS: Object.getOwnPropertyDescriptor(globalThis, 'CSS'),
  offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight'),
  clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight'),
};

beforeEach(() => {
  frames.length = 0;
  browser.anchoring = false;
  Object.defineProperty(globalThis, 'CSS', {
    configurable: true,
    writable: true,
    value: { supports: () => browser.anchoring },
  });
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
    frames.push(() => callback(0));
    return frames.length;
  };
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return Number(this.dataset.height ?? 0);
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return Number(this.dataset.client ?? 0);
    },
  });
});

afterEach(() => {
  globalThis.requestAnimationFrame = original.requestAnimationFrame;
  if (original.CSS) Object.defineProperty(globalThis, 'CSS', original.CSS);
  if (original.offsetHeight)
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', original.offsetHeight);
  if (original.clientHeight)
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', original.clientHeight);
});

function runFrames() {
  act(() => {
    for (const frame of frames.splice(0)) frame();
  });
}

function Transcript({
  count,
  focusIndex = -1,
  height = 5000,
  withScroller = true,
}: {
  count: number;
  focusIndex?: number;
  height?: number;
  withScroller?: boolean;
}) {
  const scroller = React.useRef<HTMLDivElement>(null);
  const content = React.useRef<HTMLDivElement>(null);
  const start = useTranscriptWindow({ count, focusIndex, scroller, content });
  const blocks = Array.from({ length: count }, (_, index) => index).slice(start);
  const column = (
    <div ref={content} data-height={height} data-testid='content'>
      {blocks.map((index) => (
        <p key={index} data-testid={`block-${index}`} />
      ))}
    </div>
  );
  return withScroller ? (
    <div ref={scroller} data-testid='scroller' data-client={800}>
      {column}
    </div>
  ) : (
    column
  );
}

function setup(props: React.ComponentProps<typeof Transcript>) {
  const view = render(<Transcript {...props} />);
  const scroller = view.queryByTestId('scroller');
  return { ...view, scroller };
}

function shown(view: ReturnType<typeof setup>) {
  return view.getByTestId('content').children.length;
}

function placeBlocks(view: ReturnType<typeof setup>, scroller: HTMLElement) {
  const inserted = { height: 0 };
  view.getByTestId('content').getBoundingClientRect = () => ({ top: -scroller.scrollTop }) as DOMRect;
  view.getByTestId('block-22').getBoundingClientRect = () =>
    ({ top: inserted.height - scroller.scrollTop }) as DOMRect;
  return inserted;
}

describe('useTranscriptWindow', () => {
  it('renders the newest blocks first', () => {
    const view = setup({ count: 30 });
    expect(shown(view)).toBe(INITIAL_BLOCKS);
    expect(view.getByTestId('block-29')).toBeDefined();
    expect(view.queryByTestId('block-21')).toBeNull();
  });

  it('renders older blocks until a short page is filled', () => {
    const view = setup({ count: 30, height: 100 });
    expect(shown(view)).toBe(30);
  });

  it('grows above the view near the top and keeps what you were reading in place', () => {
    const view = setup({ count: 30 });
    const scroller = view.scroller as HTMLElement;
    const inserted = placeBlocks(view, scroller);
    scroller.scrollTop = 100;
    act(() => {
      fireEvent.scroll(scroller);
      scroller.scrollTop = 60;
      inserted.height = 400;
    });
    expect(shown(view)).toBe(INITIAL_BLOCKS + GROW_BLOCKS);
    expect(scroller.scrollTop).toBe(460);
    scroller.scrollTop = 4000;
    act(() => {
      fireEvent.scroll(scroller);
    });
    expect(shown(view)).toBe(INITIAL_BLOCKS + GROW_BLOCKS);
  });

  it('leaves the place to a browser that anchors the scroll', () => {
    browser.anchoring = true;
    const view = setup({ count: 30 });
    const scroller = view.scroller as HTMLElement;
    const inserted = placeBlocks(view, scroller);
    scroller.scrollTop = 100;
    act(() => {
      fireEvent.scroll(scroller);
      scroller.scrollTop = 460;
      inserted.height = 400;
    });
    expect(shown(view)).toBe(INITIAL_BLOCKS + GROW_BLOCKS);
    expect(scroller.scrollTop).toBe(460);
  });

  it('keeps the place itself at the very top, where the browser does not anchor', () => {
    browser.anchoring = true;
    const view = setup({ count: 30 });
    const scroller = view.scroller as HTMLElement;
    const inserted = placeBlocks(view, scroller);
    scroller.scrollTop = 0;
    act(() => {
      fireEvent.scroll(scroller);
      inserted.height = 400;
    });
    expect(scroller.scrollTop).toBe(400);
  });

  it('keeps growing while the view stays near the top', () => {
    const view = setup({ count: 30 });
    const scroller = view.scroller as HTMLElement;
    scroller.scrollTop = 0;
    act(() => {
      fireEvent.scroll(scroller);
    });
    expect(shown(view)).toBe(INITIAL_BLOCKS + GROW_BLOCKS);
    runFrames();
    expect(shown(view)).toBe(INITIAL_BLOCKS + 2 * GROW_BLOCKS);
  });

  it('skips an anchor that left the page', () => {
    const view = setup({ count: 30 });
    const scroller = view.scroller as HTMLElement;
    scroller.scrollTop = 4000;
    const first = view.getByTestId('block-22');
    first.getBoundingClientRect = () => {
      Object.defineProperty(first, 'isConnected', { configurable: true, value: false });
      return { top: 0 } as DOMRect;
    };
    scroller.scrollTop = 0;
    act(() => {
      fireEvent.scroll(scroller);
    });
    expect(scroller.scrollTop).toBe(0);
  });

  it('reaches back to a focused run and keeps it after the focus clears', () => {
    const view = setup({ count: 30 });
    view.rerender(<Transcript count={30} focusIndex={3} />);
    expect(view.getByTestId('block-2')).toBeDefined();
    view.rerender(<Transcript count={30} />);
    expect(view.getByTestId('block-2')).toBeDefined();
  });

  it('does nothing without a scroller', () => {
    const view = setup({ count: 30, withScroller: false });
    expect(shown(view)).toBe(INITIAL_BLOCKS);
  });
});

describe('useTranscriptWindow while hidden', () => {
  it('goes back to the newest blocks once its page or tab is hidden', () => {
    const page = (mode: 'visible' | 'hidden') => (
      <React.Activity mode={mode}>
        <Transcript count={30} />
      </React.Activity>
    );
    const view = render(page('visible'));
    const scroller = view.getByTestId('scroller');
    scroller.scrollTop = 0;
    act(() => {
      fireEvent.scroll(scroller);
    });
    expect(view.getByTestId('content').children.length).toBe(INITIAL_BLOCKS + GROW_BLOCKS);
    act(() => view.rerender(page('hidden')));
    act(() => view.rerender(page('visible')));
    expect(view.getByTestId('content').children.length).toBe(INITIAL_BLOCKS);
  });
});
