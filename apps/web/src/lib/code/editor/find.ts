import { getSearchQuery, openSearchPanel, SearchQuery, setSearchQuery } from '@codemirror/search';
import type { EditorState } from '@codemirror/state';
import type { EditorView, Panel, ViewUpdate } from '@codemirror/view';
import type { SearchOptions } from '@/lib/code/search.ts';

export const MATCH_COUNT_LIMIT = 999;

export interface FindPanel {
  dom: HTMLElement;
  view: EditorView;
}

export interface FindSnapshot {
  panel: FindPanel | null;
  replace: boolean;
  version: number;
}

export class FindHost {
  readonly #listeners = new Set<() => void>();
  #snapshot: FindSnapshot = { panel: null, replace: false, version: 0 };

  createPanel = (view: EditorView): Panel => {
    const dom = document.createElement('div');
    dom.className = 'cm-find';
    return {
      dom,
      top: true,
      mount: () => this.#publish({ dom, view }),
      update: (update: ViewUpdate) => {
        if (update.docChanged || update.selectionSet || update.transactions.length > 0)
          this.#publish(this.#snapshot.panel);
      },
      destroy: () => {
        if (this.#snapshot.panel?.dom === dom) this.#publish(null);
      },
    };
  };

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  read = () => this.#snapshot;

  open = (view: EditorView, replace: boolean) => {
    this.#snapshot = { ...this.#snapshot, replace };
    openSearchPanel(view);
    this.#publish(this.#snapshot.panel);
  };

  showReplace = (replace: boolean) => {
    this.#snapshot = { ...this.#snapshot, replace };
    this.#publish(this.#snapshot.panel);
  };

  #publish(panel: FindPanel | null) {
    this.#snapshot = { ...this.#snapshot, panel, version: this.#snapshot.version + 1 };
    for (const listener of this.#listeners) listener();
  }
}

export function readFindQuery(state: EditorState): { text: string; replace: string } & SearchOptions {
  const query = getSearchQuery(state);
  return {
    text: query.search,
    replace: query.replace,
    caseSensitive: query.caseSensitive,
    wholeWord: query.wholeWord,
    regex: query.regexp,
  };
}

export function updateFindQuery(
  view: EditorView,
  text: string,
  options: SearchOptions & { replace?: string }
) {
  const query = new SearchQuery({
    search: text,
    replace: options.replace ?? getSearchQuery(view.state).replace,
    caseSensitive: options.caseSensitive,
    wholeWord: options.wholeWord,
    regexp: options.regex,
  });
  view.dispatch({ effects: setSearchQuery.of(query) });
}

export function countMatches(state: EditorState) {
  const query = getSearchQuery(state);
  if (!query.valid) return { total: 0, current: 0, capped: false };
  const cursor = query.getCursor(state);
  const selection = state.selection.main;
  let total = 0;
  let current = 0;
  for (let match = cursor.next(); !match.done; match = cursor.next()) {
    total += 1;
    if (match.value.from === selection.from && match.value.to === selection.to) current = total;
    if (total >= MATCH_COUNT_LIMIT) return { total, current, capped: true };
  }
  return { total, current, capped: false };
}

export function describeMatchCount(count: ReturnType<typeof countMatches>, text: string) {
  if (!text) return '';
  if (count.total === 0) return 'No results';
  const total = count.capped ? `${count.total}+` : String(count.total);
  return count.current > 0 ? `${count.current} of ${total}` : `${total} found`;
}
