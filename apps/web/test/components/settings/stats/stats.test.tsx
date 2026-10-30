import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { resolveStats } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { render } from '@testing-library/react';
import { ShippingGraph } from '@/components/settings/stats/shipping-graph.tsx';
import { StatTiles } from '@/components/settings/stats/stat-tile.tsx';
import { Breakdown } from '@/components/settings/stats/usage-tables.tsx';
import { listCalendarDays, resolveDayKey } from '@/lib/stats/days.ts';
import { findTooltipText } from '../../../support/hover.ts';

const SCROLL_WIDTH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth');

function clipEveryTruncate() {
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset.slot === 'truncate' ? this.clientWidth + 100 : 0;
    },
  });
}

function findTruncate(container: HTMLElement, text: string) {
  const element = [...container.querySelectorAll<HTMLElement>('[data-slot="truncate"]')].find(
    (candidate) => candidate.textContent === text
  );
  if (!element) throw new Error(`No truncated text reads "${text}".`);
  return element;
}

describe('statistics', () => {
  beforeEach(clipEveryTruncate);

  afterEach(() => {
    if (SCROLL_WIDTH) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', SCROLL_WIDTH);
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollWidth');
  });

  it('shows a tile’s label and detail in full in a tooltip when they are cut off', async () => {
    const view = render(
      <TooltipProvider>
        <StatTiles
          tiles={[{ key: 'cache', label: 'Cache hit rate', value: '98%', detail: '3.3B read from cache' }]}
        />
      </TooltipProvider>
    );
    expect(await findTooltipText(findTruncate(view.container, '3.3B read from cache'))).toBe(
      '3.3B read from cache'
    );
    expect(await findTooltipText(findTruncate(view.container, 'Cache hit rate'))).toBe('Cache hit rate');
  });

  it('shows a breakdown’s title and row label in full in a tooltip when they are cut off', async () => {
    const view = render(
      <TooltipProvider>
        <Breakdown
          title='By kind of work'
          rows={[{ key: 'investigator', label: 'Investigations', tokens: '1.2B', share: 0.4 }]}
        />
      </TooltipProvider>
    );
    expect(await findTooltipText(findTruncate(view.container, 'Investigations'))).toBe('Investigations');
    expect(await findTooltipText(findTruncate(view.container, 'By kind of work'))).toBe('By kind of work');
  });

  it('draws today like any other day in the year of pull requests', () => {
    const days = listCalendarDays(new Date(2026, 9, 30).getTime(), 30);
    const year = resolveStats({ tasks: {}, runs: {} }, { days, dayOf: resolveDayKey });
    const view = render(<ShippingGraph year={year} />);
    const today = view.container.querySelector('[data-day="2026-10-30"]');
    expect(today?.className).not.toContain('ring');
  });
});
