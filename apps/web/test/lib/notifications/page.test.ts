import { afterEach, describe, expect, it } from 'bun:test';
import { writePageAttention } from '@/lib/notifications/page.ts';
import { installDesktop } from '../../support/desktop.ts';

function meta(name: string) {
  return document.head.querySelectorAll<HTMLMetaElement>(`meta[name="${name}"]`);
}

afterEach(() => {
  document.title = 'Shinsa';
});

describe('the tab', () => {
  it('names the decisions up in the title and in Floaty’s meta tags, reusing the tags', () => {
    writePageAttention({ status: 'waiting', badge: 2 });
    writePageAttention({ status: 'failed', badge: 3 });
    expect(document.title).toBe('[3] Shinsa');
    expect(meta('floaty:status')).toHaveLength(1);
    expect(meta('floaty:status')[0]?.content).toBe('failed');
    expect(meta('floaty:badge')[0]?.content).toBe('3');
  });

  it('puts the same count on the Dock in the desktop app', () => {
    const desktop = installDesktop();
    writePageAttention({ status: 'waiting', badge: 2 });
    writePageAttention({ status: 'idle', badge: 0 });
    expect(desktop.badges).toEqual([2, 0]);
    desktop.restore();
  });
});
