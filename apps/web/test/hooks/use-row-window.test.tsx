import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, fireEvent, render } from '@testing-library/react';
import * as React from 'react';
import { useSectionWindows, WINDOW_ROWS_ATTRIBUTE } from '@/hooks/use-row-window.ts';

const observers: (() => void)[] = [];
const frames: FrameRequestCallback[] = [];
const cancelled: number[] = [];
const original = {
  ResizeObserver: globalThis.ResizeObserver,
  requestAnimationFrame: globalThis.requestAnimationFrame,
  cancelAnimationFrame: globalThis.cancelAnimationFrame,
  clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight'),
};

class FakeResizeObserver {
  constructor(callback: () => void) {
    observers.push(callback);
  }
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  observers.length = 0;
  frames.length = 0;
  cancelled.length = 0;
  globalThis.requestAnimationFrame = (callback) => frames.push(callback);
  globalThis.cancelAnimationFrame = (handle) => {
    cancelled.push(handle);
  };
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return Number(this.dataset.client ?? 0);
    },
  });
});

afterEach(() => {
  globalThis.ResizeObserver = original.ResizeObserver;
  globalThis.requestAnimationFrame = original.requestAnimationFrame;
  globalThis.cancelAnimationFrame = original.cancelAnimationFrame;
  if (original.clientHeight)
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', original.clientHeight);
});

const SECTION_NAMES = ['first', 'second'];

let remeasureSections = () => {};

function Sections({ counts, shown = counts.map(() => true) }: { counts: number[]; shown?: boolean[] }) {
  const list = React.useRef<HTMLDivElement>(null);
  const { windows, remeasure } = useSectionWindows(list, counts, 36);
  remeasureSections = remeasure;
  return (
    <div ref={list}>
      {SECTION_NAMES.slice(0, counts.length).map((name, index) =>
        shown[index] ? (
          <div key={name} data-testid={`section-${index}`} {...{ [WINDOW_ROWS_ATTRIBUTE]: index }}>
            {windows[index]?.start}-{windows[index]?.end}
          </div>
        ) : null
      )}
    </div>
  );
}

function paintFirstFrame() {
  act(() => {
    for (const frame of frames.splice(0)) frame(0);
  });
}

function placeSection(view: ReturnType<typeof render>, index: number, top: number) {
  view.getByTestId(`section-${index}`).getBoundingClientRect = () => ({ top }) as DOMRect;
}

describe('useSectionWindows', () => {
  it('draws only the rows in view first, and a viewport more each way after the first frame', () => {
    const view = render(
      <div data-testid='scroller' data-client={360} style={{ overflowY: 'auto' }}>
        <Sections counts={[300]} />
      </div>
    );
    expect(view.getByTestId('section-0').textContent).toBe('0-16');
    paintFirstFrame();
    expect(view.getByTestId('section-0').textContent).toBe('0-24');
  });

  it('cancels its first frame when it goes before the frame comes', () => {
    const view = render(<Sections counts={[30]} />);
    view.unmount();
    expect(cancelled).toEqual([frames.length]);
  });

  it('moves the window without waiting while the rows in view are still drawn', () => {
    const view = render(
      <div data-testid='scroller' data-client={360} style={{ overflowY: 'auto' }}>
        <Sections counts={[300]} />
      </div>
    );
    paintFirstFrame();
    placeSection(view, 0, -360);
    act(() => {
      fireEvent.scroll(view.getByTestId('scroller'));
    });
    expect(view.getByTestId('section-0').textContent).toBe('0-32');
    placeSection(view, 0, -360);
    act(() => {
      fireEvent.scroll(view.getByTestId('scroller'));
    });
    expect(view.getByTestId('section-0').textContent).toBe('0-32');
  });

  it('draws a viewport ahead as soon as the list scrolls, before the first frame', () => {
    const view = render(
      <div data-testid='scroller' data-client={360} style={{ overflowY: 'auto' }}>
        <Sections counts={[300]} />
      </div>
    );
    placeSection(view, 0, -3600);
    act(() => {
      fireEvent.scroll(view.getByTestId('scroller'));
    });
    expect(view.getByTestId('section-0').textContent).toBe('88-128');
  });

  it('windows every section of its scroller from one scroll listener', () => {
    const view = render(
      <div data-testid='scroller' data-client={360} style={{ overflowY: 'auto' }}>
        <Sections counts={[300, 40]} />
      </div>
    );
    paintFirstFrame();
    expect(view.getByTestId('section-0').textContent).toBe('0-24');
    placeSection(view, 0, -3600);
    placeSection(view, 1, 2000);
    act(() => {
      fireEvent.scroll(view.getByTestId('scroller'));
    });
    expect(view.getByTestId('section-0').textContent).toBe('88-128');
    expect(view.getByTestId('section-1').textContent).toBe('0-0');
    placeSection(view, 1, 100);
    act(() => {
      for (const observer of observers) observer();
    });
    expect(view.getByTestId('section-1').textContent).toBe('0-24');
  });

  it('covers a tall viewport with as many rows again on each side', () => {
    const view = render(
      <div data-testid='scroller' data-client={900} style={{ overflowY: 'auto' }}>
        <Sections counts={[300]} />
      </div>
    );
    placeSection(view, 0, -3600);
    act(() => {
      fireEvent.scroll(view.getByTestId('scroller'));
    });
    expect(view.getByTestId('section-0').textContent).toBe('72-152');
  });

  it('follows the window when nothing scrolls', () => {
    const view = render(<Sections counts={[50]} />);
    paintFirstFrame();
    placeSection(view, 0, -1850);
    act(() => {
      dispatchEvent(new Event('resize'));
    });
    expect(view.getByTestId('section-0').textContent).toBe('24-50');
  });

  it('measures a section again the moment it is revealed, before it paints', () => {
    const view = render(
      <div data-testid='scroller' data-client={360} style={{ overflowY: 'auto' }}>
        <Sections counts={[300, 300]} shown={[true, false]} />
      </div>
    );
    paintFirstFrame();
    view.rerender(
      <div data-testid='scroller' data-client={360} style={{ overflowY: 'auto' }}>
        <Sections counts={[300, 300]} shown={[true, true]} />
      </div>
    );
    placeSection(view, 1, -3600);
    act(() => remeasureSections());
    expect(view.getByTestId('section-1').textContent).toBe('88-128');
  });

  it('starts a section it has not measured yet at its first rows', () => {
    const view = render(
      <div data-testid='scroller' data-client={360} style={{ overflowY: 'auto' }}>
        <Sections counts={[30]} />
      </div>
    );
    view.rerender(
      <div data-testid='scroller' data-client={360} style={{ overflowY: 'auto' }}>
        <Sections counts={[30, 30]} />
      </div>
    );
    expect(view.getByTestId('section-1').textContent).toBe('0-16');
  });
});
