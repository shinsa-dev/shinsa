import { describe, expect, it } from 'bun:test';
import { EditorSelection } from '@codemirror/state';
import {
  countMatches,
  describeMatchCount,
  FindHost,
  MATCH_COUNT_LIMIT,
  readFindQuery,
  updateFindQuery,
} from '@/lib/code/editor/find.ts';
import { closeSearchPanel, findNext, openSearchPanel } from '@/lib/code/editor/setup.ts';
import { createView } from './support.ts';

const OPTIONS = { caseSensitive: false, wholeWord: false, regex: false };

describe('the find panel', () => {
  it('hands its element and view to the page while it is open, and tells it of every change', () => {
    const host = new FindHost();
    const view = createView('cat concat\nCat', [], () => true, host);
    let heard = 0;
    const stop = host.subscribe(() => {
      heard += 1;
    });
    expect(host.read().panel).toBeNull();
    openSearchPanel(view);
    const open = host.read();
    expect(open.panel?.view).toBe(view);
    expect(open.panel?.dom.classList.contains('cm-find')).toBe(true);
    updateFindQuery(view, 'cat', OPTIONS);
    expect(host.read().version).toBeGreaterThan(open.version);
    view.dispatch({ changes: { from: 0, insert: 'x' } });
    view.dispatch({ selection: { anchor: 1 } });
    closeSearchPanel(view);
    expect(host.read().panel).toBeNull();
    stop();
    const before = heard;
    openSearchPanel(view);
    expect(heard).toBe(before);
  });

  it('ignores the end of a panel it no longer holds', () => {
    const host = new FindHost();
    const first = host.createPanel(createView('a', []));
    const second = host.createPanel(createView('b', []));
    first.mount?.();
    second.mount?.();
    first.destroy?.();
    expect(host.read().panel?.dom).toBe(second.dom);
  });

  it('reads and writes the query with its options', () => {
    const view = createView('cat concat Cat', []);
    openSearchPanel(view);
    updateFindQuery(view, 'cat', { caseSensitive: true, wholeWord: true, regex: false });
    expect(readFindQuery(view.state)).toEqual({
      text: 'cat',
      caseSensitive: true,
      wholeWord: true,
      regex: false,
    });
    expect(countMatches(view.state)).toEqual({ total: 1, current: 0, capped: false });
    updateFindQuery(view, 'cat', OPTIONS);
    expect(countMatches(view.state).total).toBe(3);
    findNext(view);
    expect(countMatches(view.state).current).toBe(1);
    updateFindQuery(view, '(', { ...OPTIONS, regex: true });
    expect(countMatches(view.state)).toEqual({ total: 0, current: 0, capped: false });
  });

  it('stops counting at the limit', () => {
    const view = createView('a'.repeat(MATCH_COUNT_LIMIT + 5), []);
    view.dispatch({ selection: EditorSelection.single(0) });
    updateFindQuery(view, 'a', OPTIONS);
    expect(countMatches(view.state)).toMatchObject({ total: MATCH_COUNT_LIMIT, capped: true });
  });

  it('describes the count', () => {
    expect(describeMatchCount({ total: 3, current: 0, capped: false }, '')).toBe('');
    expect(describeMatchCount({ total: 0, current: 0, capped: false }, 'x')).toBe('No results');
    expect(describeMatchCount({ total: 3, current: 2, capped: false }, 'x')).toBe('2 of 3');
    expect(describeMatchCount({ total: 999, current: 0, capped: true }, 'x')).toBe('999+ found');
  });
});
