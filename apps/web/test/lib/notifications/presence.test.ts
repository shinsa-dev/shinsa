import { describe, expect, it } from 'bun:test';
import { isPageActive, PRESENCE_INTERVAL_MS, watchPresence } from '@/lib/notifications/presence.ts';

function createPage() {
  const target = new EventTarget();
  const doc = Object.assign(new EventTarget(), {
    visibilityState: 'visible' as DocumentVisibilityState,
    focused: true,
    hasFocus() {
      return this.focused;
    },
  });
  let now = 1_000;
  const reports: number[] = [];
  const stop = watchPresence(
    () => reports.push(now),
    target as unknown as Window,
    doc as unknown as Document,
    () => now
  );
  return {
    target,
    doc,
    reports,
    stop,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe('isPageActive', () => {
  it('is in use only while the page is visible and has the focus', () => {
    expect(isPageActive({ visibilityState: 'visible', hasFocus: () => true })).toBe(true);
    expect(isPageActive({ visibilityState: 'hidden', hasFocus: () => true })).toBe(false);
    expect(isPageActive({ visibilityState: 'visible', hasFocus: () => false })).toBe(false);
    expect(isPageActive(null)).toBe(false);
    expect(typeof isPageActive()).toBe('boolean');
  });
});

describe('watchPresence', () => {
  it('reports use at most once per interval, and at once when you come back to the page', () => {
    const page = createPage();
    page.target.dispatchEvent(new Event('pointermove'));
    page.target.dispatchEvent(new Event('keydown'));
    expect(page.reports).toEqual([1_000]);
    page.advance(PRESENCE_INTERVAL_MS - 1);
    page.target.dispatchEvent(new Event('wheel'));
    expect(page.reports).toHaveLength(1);
    page.target.dispatchEvent(new Event('focus'));
    expect(page.reports).toHaveLength(2);
    page.advance(PRESENCE_INTERVAL_MS);
    page.target.dispatchEvent(new Event('pointerdown'));
    page.doc.dispatchEvent(new Event('visibilitychange'));
    expect(page.reports).toHaveLength(4);
    page.stop();
  });

  it('reports nothing from a page in the background, and nothing once stopped', () => {
    const page = createPage();
    page.doc.focused = false;
    page.target.dispatchEvent(new Event('focus'));
    page.doc.visibilityState = 'hidden';
    page.doc.focused = true;
    page.doc.dispatchEvent(new Event('visibilitychange'));
    expect(page.reports).toEqual([]);
    page.doc.visibilityState = 'visible';
    page.stop();
    page.target.dispatchEvent(new Event('focus'));
    page.doc.dispatchEvent(new Event('visibilitychange'));
    expect(page.reports).toEqual([]);
  });

  it('watches this window and page on its own clock when given nothing else', () => {
    const reports: string[] = [];
    const stop = watchPresence(() => reports.push('used'));
    window.dispatchEvent(new Event('focus'));
    stop();
    expect(reports.length).toBe(isPageActive() ? 1 : 0);
  });
});
