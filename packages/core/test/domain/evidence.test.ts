import { describe, expect, test } from 'bun:test';
import {
  type Evidence,
  isEvidenceKey,
  listEarlierEvidenceItems,
  listEvidenceItems,
  resolveEvidenceKey,
  selectEvidenceItem,
} from '../../src/index.ts';

function piece(id: string, fields: Partial<Evidence> = {}): Evidence {
  return {
    id,
    taskId: 't',
    runId: 'r',
    kind: 'screenshot',
    title: id,
    uri: `/e/${id}.png`,
    attachedAt: 0,
    ...fields,
  };
}

describe('listEvidenceItems', () => {
  test('a before and its after at the same title, width and theme are one comparison, before first', () => {
    const after = piece('after', { title: 'Settings', width: 1280, theme: 'dark', stage: 'after' });
    const before = piece('before', { title: 'Settings', width: 1280, theme: 'dark', stage: 'before' });
    const phone = piece('phone', { title: 'Settings', width: 390, theme: 'dark', stage: 'after' });
    expect(listEvidenceItems([after, before, phone])).toEqual([
      {
        id: 'after',
        key: 'settings-1280-dark',
        kind: 'comparison',
        title: 'Settings',
        parts: [before, after],
        updated: null,
      },
      {
        id: 'phone',
        key: 'settings-390-dark',
        kind: 'screenshot',
        title: 'Settings',
        parts: [phone],
        updated: null,
      },
    ]);
  });

  test('parts attached together share an item, and a later after at their title joins it', () => {
    const before = piece('before', { title: 'Tabs', stage: 'before', itemId: 'i1' });
    const loading = piece('loading', { title: 'Tabs', label: 'Loading', itemId: 'i1' });
    const later = piece('later', { title: 'Tabs', stage: 'after', kind: 'recording' });
    const elsewhere = piece('elsewhere', { title: 'Tabs', stage: 'after', round: 2 });
    expect(listEvidenceItems([before, loading, later, elsewhere])).toEqual([
      {
        id: 'i1',
        key: 'tabs',
        kind: 'comparison',
        title: 'Tabs',
        parts: [before, loading, later],
        updated: null,
      },
      { id: 'elsewhere', key: 'tabs', kind: 'screenshot', title: 'Tabs', parts: [elsewhere], updated: null },
    ]);
  });

  test('a stage shot again pairs its latest shot, and the earlier one stays an item of its own', () => {
    const first = piece('first', { title: 'Home', stage: 'after' });
    const before = piece('before', { title: 'Home', stage: 'before' });
    const again = piece('again', { title: 'Home', stage: 'after' });
    expect(listEvidenceItems([first, before, again])).toEqual([
      { id: 'first', key: 'home', kind: 'screenshot', title: 'Home', parts: [first], updated: null },
      { id: 'before', key: 'home', kind: 'comparison', title: 'Home', parts: [before, again], updated: null },
    ]);
  });

  test('every other piece is an item of its own kind, in the order attached', () => {
    const run = piece('test', { kind: 'test', title: 'Tests', uri: '/e/t.txt' });
    const twin = piece('twin', { kind: 'test', title: 'Tests', uri: '/e/u.txt', stage: 'after' });
    const shot = piece('shot');
    expect(listEvidenceItems([run, twin, shot]).map((item) => [item.id, item.kind])).toEqual([
      ['test', 'test'],
      ['twin', 'test'],
      ['shot', 'screenshot'],
    ]);
  });
});

describe('resolveEvidenceKey', () => {
  test('is the key the agent gave, else the check it links, else its title, width and theme', () => {
    expect(resolveEvidenceKey(piece('a', { key: 'settings-dark-900' }))).toBe('settings-dark-900');
    expect(resolveEvidenceKey(piece('b', { kind: 'test', checkId: 'c2' }))).toBe('check-c2');
    expect(resolveEvidenceKey(piece('c', { title: 'Settings, Écran', width: 900, theme: 'dark' }))).toBe(
      'settings-ecran-900-dark'
    );
    expect(resolveEvidenceKey(piece('d', { kind: 'note', title: 'Timings' }))).toBe('note-timings');
    expect(resolveEvidenceKey(piece('e', { title: '!!!' }))).toBe('evidence');
  });

  test('a key is lower-case words joined by single hyphens, 60 characters at most', () => {
    expect(isEvidenceKey('settings-dark-900')).toBe(true);
    expect(isEvidenceKey('Settings')).toBe(false);
    expect(isEvidenceKey('a--b')).toBe(false);
    expect(isEvidenceKey('a'.repeat(61))).toBe(false);
  });
});

describe('replaced and removed evidence', () => {
  const old = piece('old', { title: 'Settings', stage: 'after', replacedBy: 'new' });
  const before = piece('before', { title: 'Settings', stage: 'before' });
  const fresh = piece('new', { title: 'Settings', stage: 'after', fixFor: 'you' });
  const note = piece('note', {
    kind: 'note',
    title: 'Timings',
    uri: '/e/n.md',
    removedAt: 5,
    removedReason: 'Stale.',
  });
  const banner = piece('banner', { title: 'Banner', replacedBy: 'banner-2' });
  const banner2 = piece('banner-2', { title: 'Banner' });

  test('only current pieces are items, and an item that replaced one says after what', () => {
    expect(listEvidenceItems([old, before, fresh, note, banner, banner2])).toEqual([
      {
        id: 'before',
        key: 'settings',
        kind: 'comparison',
        title: 'Settings',
        parts: [before, fresh],
        updated: 'you',
      },
      {
        id: 'banner-2',
        key: 'banner',
        kind: 'screenshot',
        title: 'Banner',
        parts: [banner2],
        updated: 'work',
      },
    ]);
  });

  test('the earlier items keep what replaced or removed them', () => {
    expect(listEarlierEvidenceItems([old, before, fresh, note, banner, banner2])).toEqual([
      { id: 'old', key: 'settings', kind: 'screenshot', title: 'Settings', parts: [old], removed: null },
      {
        id: 'note',
        key: 'note-timings',
        kind: 'note',
        title: 'Timings',
        parts: [note],
        removed: { at: 5, reason: 'Stale.' },
      },
      { id: 'banner', key: 'banner', kind: 'screenshot', title: 'Banner', parts: [banner], removed: null },
    ]);
    expect(listEarlierEvidenceItems([piece('gone', { removedAt: 1 })])[0]?.removed).toEqual({
      at: 1,
      reason: '',
    });
  });

  test('an item is found by its id, its key or the id of one of its parts', () => {
    const items = listEvidenceItems([before, fresh, banner2]);
    expect(selectEvidenceItem(items, 'settings')?.id).toBe('before');
    expect(selectEvidenceItem(items, 'new')?.id).toBe('before');
    expect(selectEvidenceItem(items, 'banner-2')?.key).toBe('banner');
    expect(selectEvidenceItem(items, 'missing')).toBeNull();
  });
});
