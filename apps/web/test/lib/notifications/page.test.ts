import { afterEach, describe, expect, it } from 'bun:test';
import { writePageAttention } from '@/lib/notifications/page.ts';

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
});
