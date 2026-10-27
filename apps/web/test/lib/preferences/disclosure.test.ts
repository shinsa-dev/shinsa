import { describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import {
  createDisclosureId,
  DISCLOSURE_LIMIT,
  DISCLOSURE_STORE_KEY,
  DISCLOSURE_STORE_VERSION,
  DISCLOSURE_WRITE_DELAY_MS,
  type DisclosureId,
  extendDisclosureId,
  flushDisclosures,
  listMarkedDisclosures,
  notPersisted,
  parseDisclosures,
  readDisclosure,
  resetDisclosures,
  serializeDisclosures,
  useDisclosure,
  useDisclosureSet,
  writeDisclosure,
} from '@/lib/preferences/disclosure.ts';

const CARD = createDisclosureId('task', 't1', 'review', 'card', 'p1');

function stored() {
  return parseDisclosures(localStorage.getItem(DISCLOSURE_STORE_KEY));
}

function storeRaw(entries: [string, boolean][]) {
  return JSON.stringify({ version: DISCLOSURE_STORE_VERSION, entries });
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('disclosure ids', () => {
  it('joins the scope and parts, escaping a colon inside a part', () => {
    expect(String(CARD)).toBe('task:t1:review:card:p1');
    expect(String(createDisclosureId('home', 'section', 'a:b'))).toBe('home:section:a%3Ab');
  });

  it('extends an id, and leaves an opt-out alone', () => {
    expect(String(extendDisclosureId(CARD, 'snippet'))).toBe('task:t1:review:card:p1:snippet');
    const opted = notPersisted('a menu');
    expect(extendDisclosureId(opted, 'x')).toBe(opted);
    expect(opted.notPersisted).toBe('a menu');
  });
});

describe('the stored disclosures', () => {
  it('parses only its own version and well-formed entries', () => {
    expect(parseDisclosures(null).size).toBe(0);
    expect(parseDisclosures('not json').size).toBe(0);
    expect(parseDisclosures('null').size).toBe(0);
    expect(parseDisclosures(JSON.stringify({ version: 0, entries: [['a', true]] })).size).toBe(0);
    expect(parseDisclosures(JSON.stringify({ version: DISCLOSURE_STORE_VERSION })).size).toBe(0);
    const parsed = parseDisclosures(
      JSON.stringify({
        version: DISCLOSURE_STORE_VERSION,
        entries: [['a', true], ['b'], [1, false], ['c', false]],
      })
    );
    expect([...parsed]).toEqual([
      ['a', true],
      ['c', false],
    ]);
  });

  it('keeps the newest entries when the stored list is over the limit', () => {
    const many = Array.from({ length: DISCLOSURE_LIMIT + 5 }, (_, n): [string, boolean] => [`id${n}`, true]);
    const parsed = parseDisclosures(storeRaw(many));
    expect(parsed.size).toBe(DISCLOSURE_LIMIT);
    expect(parsed.has('id0')).toBe(false);
    expect(parsed.has(`id${DISCLOSURE_LIMIT + 4}`)).toBe(true);
  });

  it('serializes in order with its version', () => {
    expect(serializeDisclosures(new Map([['a', false]]))).toBe(storeRaw([['a', false]]));
  });

  it('reads what is stored when first asked', () => {
    localStorage.setItem(DISCLOSURE_STORE_KEY, storeRaw([[CARD, false]]));
    expect(readDisclosure(CARD)).toBe(false);
  });

  it('writes after a pause, once, and on flush right away', async () => {
    writeDisclosure(CARD, false);
    expect(readDisclosure(CARD)).toBe(false);
    expect(localStorage.getItem(DISCLOSURE_STORE_KEY)).toBeNull();
    await wait(DISCLOSURE_WRITE_DELAY_MS + 20);
    expect(stored().get(CARD)).toBe(false);
    writeDisclosure(CARD, true);
    writeDisclosure(CARD, true);
    flushDisclosures();
    expect(stored().get(CARD)).toBe(true);
  });

  it('writes on pagehide, and does nothing once reset', () => {
    writeDisclosure(CARD, false);
    dispatchEvent(new Event('pagehide'));
    expect(stored().get(CARD)).toBe(false);
    resetDisclosures();
    localStorage.clear();
    dispatchEvent(new Event('pagehide'));
    expect(localStorage.getItem(DISCLOSURE_STORE_KEY)).toBeNull();
  });

  it('drops the least recently toggled entries past the limit', () => {
    const first = createDisclosureId('ui', 'first');
    writeDisclosure(first, true);
    for (let n = 0; n < DISCLOSURE_LIMIT; n += 1) writeDisclosure(createDisclosureId('ui', `n${n}`), true);
    expect(readDisclosure(first)).toBeUndefined();
    writeDisclosure(createDisclosureId('ui', 'n0'), false);
    for (let n = 0; n < 2; n += 1) writeDisclosure(createDisclosureId('ui', `more${n}`), true);
    expect(readDisclosure(createDisclosureId('ui', 'n0'))).toBe(false);
    expect(readDisclosure(createDisclosureId('ui', 'n1'))).toBeUndefined();
    flushDisclosures();
    expect(stored().size).toBe(DISCLOSURE_LIMIT);
  });

  it('lists the marked children of an id', () => {
    const tree = createDisclosureId('task', 't1', 'code', 'files');
    writeDisclosure(extendDisclosureId(tree, 'src') as DisclosureId, true);
    writeDisclosure(extendDisclosureId(tree, 'a:b') as DisclosureId, true);
    writeDisclosure(extendDisclosureId(tree, 'test') as DisclosureId, false);
    writeDisclosure(createDisclosureId('task', 't1', 'code', 'filesx'), true);
    expect(listMarkedDisclosures(tree, true)).toEqual(['a:b', 'src']);
    expect(listMarkedDisclosures(tree, false)).toEqual(['test']);
  });
});

describe('another tab', () => {
  it('takes the other tab’s writes and keeps its own unsaved ones', () => {
    const other = createDisclosureId('home', 'section', 'needs');
    readDisclosure(CARD);
    writeDisclosure(CARD, false);
    dispatchEvent(
      new StorageEvent('storage', {
        key: DISCLOSURE_STORE_KEY,
        newValue: storeRaw([
          [other, false],
          [CARD, true],
        ]),
      })
    );
    expect(readDisclosure(other)).toBe(false);
    expect(readDisclosure(CARD)).toBe(false);
  });

  it('ignores other keys and empties on a clear', () => {
    writeDisclosure(CARD, false);
    flushDisclosures();
    dispatchEvent(new StorageEvent('storage', { key: 'shinsa.theme', newValue: 'dark' }));
    expect(readDisclosure(CARD)).toBe(false);
    dispatchEvent(new StorageEvent('storage', { key: null, newValue: null }));
    expect(readDisclosure(CARD)).toBeUndefined();
  });

  it('updates a mounted disclosure', () => {
    const { result } = renderHook(() => useDisclosure(CARD, true));
    expect(result.current.open).toBe(true);
    act(() => {
      dispatchEvent(
        new StorageEvent('storage', { key: DISCLOSURE_STORE_KEY, newValue: storeRaw([[CARD, false]]) })
      );
    });
    expect(result.current.open).toBe(false);
  });
});

describe('useDisclosure', () => {
  it('starts from the default until it is toggled, then remembers', () => {
    const { result, unmount } = renderHook(() => useDisclosure(CARD, true));
    expect(result.current.open).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.open).toBe(false);
    unmount();
    expect(renderHook(() => useDisclosure(CARD, true)).result.current.open).toBe(false);
  });

  it('reads the stored value on its first render', () => {
    localStorage.setItem(DISCLOSURE_STORE_KEY, storeRaw([[CARD, false]]));
    const renders: boolean[] = [];
    renderHook(() => {
      const disclosure = useDisclosure(CARD, true);
      renders.push(disclosure.open);
      return disclosure;
    });
    expect(renders[0]).toBe(false);
  });

  it('opens on request and survives a reset of the cache', () => {
    const { result } = renderHook(() => useDisclosure(CARD, false));
    act(() => result.current.replaceOpen(true));
    flushDisclosures();
    resetDisclosures();
    expect(renderHook(() => useDisclosure(CARD, false)).result.current.open).toBe(true);
  });

  it('keeps an opted-out disclosure in the component only', () => {
    const { result, unmount } = renderHook(() => useDisclosure(notPersisted('a menu'), false));
    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);
    flushDisclosures();
    expect(stored().size).toBe(0);
    unmount();
    expect(renderHook(() => useDisclosure(notPersisted('a menu'), false)).result.current.open).toBe(false);
  });
});

describe('useDisclosureSet', () => {
  const TREE = createDisclosureId('task', 't1', 'code', 'changes');

  it('remembers which members are marked', () => {
    const { result, unmount } = renderHook(() => useDisclosureSet(TREE, false));
    expect([...result.current[0]]).toEqual([]);
    act(() => result.current[1]('src', true));
    act(() => result.current[1]('test', true));
    act(() => result.current[1]('test', false));
    expect([...result.current[0]]).toEqual(['src']);
    unmount();
    expect([...renderHook(() => useDisclosureSet(TREE, false)).result.current[0]]).toEqual(['src']);
    expect(readDisclosure(extendDisclosureId(TREE, 'test') as DisclosureId)).toBe(true);
  });

  it('keeps an opted-out set in the component', () => {
    const { result } = renderHook(() => useDisclosureSet(notPersisted('search results'), true));
    act(() => result.current[1]('a', true));
    act(() => result.current[1]('b', true));
    act(() => result.current[1]('a', false));
    expect([...result.current[0]]).toEqual(['b']);
    flushDisclosures();
    expect(stored().size).toBe(0);
  });
});
