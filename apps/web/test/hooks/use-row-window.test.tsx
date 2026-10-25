import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, fireEvent, render } from '@testing-library/react';
import { WindowedRows } from '@/components/queue/windowed-rows.tsx';

const observers: (() => void)[] = [];
const original = {
  ResizeObserver: globalThis.ResizeObserver,
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
  if (original.clientHeight)
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', original.clientHeight);
});

const ITEMS = Array.from({ length: 300 }, (_, index) => index);

function rows(items: number[], gap?: number) {
  return (
    <WindowedRows items={items} rowHeight={36} gap={gap}>
      {(item) => (
        <p key={item} data-testid='row'>
          {item}
        </p>
      )}
    </WindowedRows>
  );
}

function listOf(view: ReturnType<typeof render>) {
  return view.getAllByTestId('row')[0]?.parentElement as HTMLElement;
}

describe('WindowedRows', () => {
  it('renders the rows in view of its scroller and moves with the scroll', () => {
    const view = render(
      <div data-testid='scroller' data-client={360} style={{ overflowY: 'auto' }}>
        <section>{rows(ITEMS)}</section>
      </div>
    );
    const scroller = view.getByTestId('scroller');
    expect(view.getAllByTestId('row')).toHaveLength(24);
    const list = listOf(view);
    list.getBoundingClientRect = () => ({ top: -3600 }) as DOMRect;
    act(() => {
      fireEvent.scroll(scroller);
    });
    const shown = view.getAllByTestId('row');
    expect(shown[0]?.textContent).toBe('88');
    expect(shown).toHaveLength(40);
    expect((list.firstElementChild as HTMLElement).style.height).toBe(`${88 * 36}px`);
    expect((list.lastElementChild as HTMLElement).style.height).toBe(`${(300 - 128) * 36}px`);
    act(() => {
      for (const observer of observers) observer();
    });
    expect(view.getAllByTestId('row')[0]?.textContent).toBe('88');
  });

  it('follows the window when nothing scrolls, and spaces rows by their gap', () => {
    const view = render(<div>{rows(ITEMS.slice(0, 50), 1)}</div>);
    const list = listOf(view);
    expect(list.style.gap).toBe('1px');
    list.getBoundingClientRect = () => ({ top: -1850 }) as DOMRect;
    act(() => {
      dispatchEvent(new Event('resize'));
    });
    expect(view.getAllByTestId('row')[0]?.textContent).toBe('32');
    expect(list.lastElementChild?.textContent).toBe('49');
  });
});
