import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, fireEvent, render } from '@testing-library/react';
import { TOOLTIP_DELAY, TooltipProvider } from '../../src/components/tooltip';
import { Truncate } from '../../src/components/truncate';
import { flush, installLayout, installResizeObserver, layout } from '../support/layout';
import { installMedia } from '../support/media';

let restoreLayout: () => void;
let resizes: ReturnType<typeof installResizeObserver>;

beforeEach(() => {
  restoreLayout = installLayout();
  resizes = installResizeObserver();
});

afterEach(() => {
  restoreLayout();
  resizes.restore();
});

const tooltipEnabled = (element: Element) => element.hasAttribute('data-tooltip-trigger');

async function hoverTooltip(element: Element) {
  const real = globalThis.setTimeout;
  globalThis.setTimeout = ((handler: () => void, ms?: number) => {
    if (ms !== TOOLTIP_DELAY) return real(handler, ms);
    handler();
    return real(() => undefined, 0);
  }) as typeof setTimeout;
  try {
    await act(async () => {
      fireEvent.pointerOver(element, { pointerType: 'mouse' });
      await flush();
    });
  } finally {
    globalThis.setTimeout = real;
  }
  return document.querySelector('[data-slot="tooltip-content"]')?.textContent;
}

describe('Truncate', () => {
  it('offers the full text in a tooltip only while the text is cut off', () => {
    const view = render(
      <Truncate data-layout={layout({ clientWidth: 100, scrollWidth: 100 })}>Fits</Truncate>
    );
    const text = view.getByText('Fits');
    expect(tooltipEnabled(text)).toBe(false);

    view.rerender(<Truncate data-layout={layout({ clientWidth: 100, scrollWidth: 180 })}>Fits</Truncate>);
    act(() => resizes.resize(text));
    expect(tooltipEnabled(view.getByText('Fits'))).toBe(true);
  });

  it('notices new text that overflows without the element changing size', async () => {
    const view = render(
      <Truncate data-layout={layout({ clientWidth: 100, scrollWidth: 60 })}>Short</Truncate>
    );
    view.rerender(
      <Truncate data-layout={layout({ clientWidth: 100, scrollWidth: 260 })}>
        A much longer title now
      </Truncate>
    );
    await act(() => flush());
    expect(tooltipEnabled(view.getByText('A much longer title now'))).toBe(true);
  });

  it('shows the given tooltip instead of the children when they are cut off', async () => {
    const media = installMedia({ '(hover: hover)': true });
    const view = render(
      <TooltipProvider>
        <Truncate tooltip='Running bun test' data-layout={layout({ clientWidth: 100, scrollWidth: 180 })}>
          <span aria-hidden>Shimmer</span>
        </Truncate>
      </TooltipProvider>
    );
    const text = view.getByText('Shimmer').parentElement as HTMLElement;
    expect(tooltipEnabled(text)).toBe(true);
    expect(await hoverTooltip(text)).toBe('Running bun test');
    media.restore();
  });

  it('offers the full text when the clamped lines cut it off', () => {
    const view = render(
      <Truncate lines={2} data-layout={layout({ clientHeight: 32, scrollHeight: 48 })}>
        Two lines of text and more
      </Truncate>
    );
    const text = view.getByText('Two lines of text and more');
    expect(tooltipEnabled(text)).toBe(true);
  });

  describe('middle', () => {
    const middle = (text: string, width: number, natural: number, parent = 200) => (
      <div data-testid='parent' data-layout={layout({ clientWidth: parent })}>
        <Truncate
          middle
          data-testid='text'
          data-layout={layout({ clientWidth: width, scrollWidth: natural })}
        >
          {text}
        </Truncate>
      </div>
    );

    it('cuts the middle of a string that overflows and keeps both ends', () => {
      const view = render(middle('feature/very-long-branch-name', 80, 240));
      const shown = view.getByTestId('text').textContent ?? '';
      expect(shown).toContain('…');
      expect(shown.startsWith('feature')).toBe(true);
      expect(shown.endsWith('name')).toBe(true);
      expect(tooltipEnabled(view.getByTestId('text'))).toBe(true);
    });

    it('measures new text instead of keeping the cut made for the old one', () => {
      const view = render(middle('feature/very-long-branch-name', 80, 240));
      view.rerender(middle('fix/another-overflowing-identifier', 80, 260));
      const shown = view.getByTestId('text').textContent ?? '';
      expect(shown.startsWith('fix/')).toBe(true);
      expect(shown.endsWith('identifier')).toBe(true);
    });

    it('shows text that fits in full, without a tooltip', () => {
      const view = render(middle('feature/very-long-branch-name', 80, 240));
      view.rerender(middle('main', 80, 30));
      expect(view.getByTestId('text').textContent).toBe('main');
      expect(tooltipEnabled(view.getByTestId('text'))).toBe(false);
    });

    it('measures again once a hidden parent gets a width', () => {
      const view = render(middle('feature/very-long-branch-name', 0, 0, 0));
      expect(view.getByTestId('text').textContent).toBe('feature/very-long-branch-name');

      view.rerender(middle('feature/very-long-branch-name', 80, 240, 200));
      act(() => resizes.resize(view.getByTestId('parent')));
      expect(view.getByTestId('text').textContent).toContain('…');
    });

    it('ignores a resize that leaves the parent the same width', () => {
      const view = render(middle('feature/very-long-branch-name', 80, 240));
      const before = view.getByTestId('text').textContent;
      act(() => resizes.resize(view.getByTestId('parent')));
      expect(view.getByTestId('text').textContent).toBe(before);
    });

    it('falls back to an end cut for content that is not a string', () => {
      const view = render(
        <Truncate middle data-testid='text'>
          <b>bold</b>
        </Truncate>
      );
      expect(view.getByTestId('text').querySelector('b')?.textContent).toBe('bold');
    });
  });
});
