import { afterEach, describe, expect, it } from 'bun:test';
import type { LanguageSupport } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { runScopeHandlers } from '@codemirror/view';
import { NO_ANNOTATIONS } from '@/lib/code/editor/annotations.ts';
import { requestLanguage } from '@/lib/code/editor/language.ts';
import { EditorSession, fromDisk, isSameText, type ShowInput } from '@/lib/code/editor/session.ts';
import { tokenField } from '@/lib/code/editor/syntax.ts';
import { packLines, type TokenAnswer } from '@/lib/code/editor/textmate.ts';
import type { TokenAsk, TokenSet } from '@/lib/code/editor/tokens.ts';

const sessions: EditorSession[] = [];

afterEach(() => {
  for (const session of sessions.splice(0)) session.destroy();
  document.body.innerHTML = '';
});

function createTokens(known: Map<string, TokenSet> = new Map()) {
  const asks: { ask: TokenAsk; answer: (answer: TokenAnswer) => void }[] = [];
  return {
    asks,
    known,
    tokens: {
      select: (_grammar: string, text: string) => known.get(text) ?? null,
      request: (ask: TokenAsk, answer: (answer: TokenAnswer) => void) => {
        asks.push({ ask, answer });
        return () => {};
      },
    },
  };
}

function createSession(
  options: {
    tokens?: ReturnType<typeof createTokens>['tokens'];
    language?: (path: string) => Promise<LanguageSupport | null>;
    limit?: number;
  } = {}
) {
  const idles: (() => void)[] = [];
  const session = new EditorSession({
    language: options.language ?? (() => Promise.resolve(null)),
    tokens: options.tokens ?? createTokens().tokens,
    idle: (run) => idles.push(run),
    ...(options.limit ? { limit: options.limit } : {}),
  });
  sessions.push(session);
  return { session, idles };
}

function createHost() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return host;
}

function input(key: string, content: string, extra: Partial<ShowInput> = {}): ShowInput {
  return {
    key,
    path: `${key}.ts`,
    content,
    original: null,
    split: false,
    annotations: { a: NO_ANNOTATIONS, b: NO_ANNOTATIONS },
    ...extra,
  };
}

describe('isSameText', () => {
  it('compares an editor document with a text', () => {
    const state = EditorState.create({ doc: 'abc' });
    expect(isSameText(state, 'abc')).toBe(true);
    expect(isSameText(state, 'abd')).toBe(false);
    expect(isSameText(state, 'ab')).toBe(false);
  });
});

describe('EditorSession', () => {
  it('keeps one editor and swaps each file’s state in, keeping its edits, folds and scroll', () => {
    const { session } = createSession();
    const host = createHost();
    expect(session.views).toBeNull();
    session.show(host, input('a', 'one'));
    const view = session.views?.b;
    view?.dispatch({ changes: { from: 0, insert: 'x' } });
    session.show(host, input('b', 'two'));
    expect(session.views?.b).toBe(view);
    expect(session.readText('b')).toBe('two');
    expect(session.readText('a')).toBe('xone');
    expect(session.readText('nothing')).toBeNull();
    session.show(host, input('a', 'xone'));
    expect(session.views?.b.state.doc.toString()).toBe('xone');
    session.show(host, input('a', 'changed on disk'));
    expect(session.views?.b.state.doc.toString()).toBe('changed on disk');
    expect(session.selectView('a')).toBe(view ?? null);
    session.findHost.showReplace(true);
    expect(session.findHost.read().replace).toBe(true);
    expect(session.selectView('b')).toBeNull();
    expect(session.current).toBe('a');
  });

  it('moves its editor to a new host and leaves an old one empty', () => {
    const { session } = createSession();
    const first = createHost();
    const second = createHost();
    session.show(first, input('a', 'one'));
    session.hide(second);
    session.show(first, input('a', 'one'));
    session.hide(first);
    expect(first.childElementCount).toBe(0);
    expect(session.views).toBeNull();
    session.show(second, input('a', 'one'));
    expect(second.querySelector('.cm-editor')).not.toBeNull();
  });

  it('forgets the oldest file beyond its limit', () => {
    const { session } = createSession({ limit: 2 });
    const host = createHost();
    session.show(host, input('a', 'one'));
    session.views?.b.dispatch({ changes: { from: 0, insert: 'x' } });
    session.show(host, input('b', 'two'));
    session.show(host, input('c', 'three'));
    session.show(host, input('d', 'four'));
    expect(session.readText('a')).toBeNull();
  });

  it('reports edits but not the disk’s, and comments through the latest page', () => {
    const { session } = createSession();
    const host = createHost();
    const edits: number[] = [];
    const comments: [string, number, number | null][] = [];
    session.latest = {
      onComment: (side, line, end) => comments.push([side, line, end]),
      onEdit: () => edits.push(1),
      onSave: () => {},
    };
    session.show(host, input('a', 'one\ntwo'));
    const view = session.views?.b;
    view?.dispatch({ changes: { from: 0, insert: 'x' } });
    view?.dispatch({ changes: { from: 0, insert: 'y' }, annotations: fromDisk.of(true) });
    view?.dispatch({ selection: { anchor: 0 } });
    expect(edits).toHaveLength(1);
    const gutter = [...host.querySelectorAll('.cm-lineNumbers .cm-gutterElement')].find(
      (element) => element.textContent === '2'
    );
    gutter?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    expect(comments).toEqual([['new', 1, null]]);
    session.latest = { ...session.latest, onComment: null };
    gutter?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    expect(comments).toHaveLength(1);
  });

  it('starts from cached tokens, colours a unified diff’s old side when its tokens arrive', () => {
    const fake = createTokens(
      new Map([['const a', { lines: [Uint32Array.from([5, 1, 7, 0])], classes: ['', 'tm-code-keyword'] }]])
    );
    const { session } = createSession({ tokens: fake.tokens });
    const host = createHost();
    session.show(host, input('a', 'const a', { original: 'let b' }));
    expect(session.views?.b.state.field(tokenField).lines).toHaveLength(1);
    const original = fake.asks.find((each) => each.ask.doc === 'a\0original');
    expect(original?.ask.text).toBe('let b');
    original?.answer({ id: 1, doc: 'a', version: 0, failed: 'no grammar' });
    original?.answer({
      id: 1,
      doc: 'a',
      version: 0,
      from: 0,
      to: 1,
      total: 1,
      ...packLines([Uint32Array.from([3, 1])]),
      classes: ['', 'tm-code-keyword'],
      done: false,
    });
    fake.known.set('let b', { lines: [Uint32Array.from([3, 1, 5, 0])], classes: ['', 'tm-code-keyword'] });
    original?.answer({
      id: 1,
      doc: 'a',
      version: 0,
      from: 0,
      to: 0,
      total: 1,
      ...packLines([]),
      classes: [],
      done: true,
    });
    expect(host.querySelector('.cm-deletedLine .tm-code-keyword')?.textContent).toBe('let');
    session.show(host, input('b', 'x', { original: 'let b' }));
    expect(host.querySelector('.cm-deletedLine .tm-code-keyword')?.textContent).toBe('let');
    const other = createSession({ tokens: createTokens().tokens }).session;
    other.show(createHost(), input('n', 'x', { path: 'notes', original: 'y' }));
    expect(other.views).not.toBeNull();
    const late = fake.asks.length;
    session.show(host, input('c', 'z', { original: 'q' }));
    session.show(host, input('d', 'z'));
    fake.asks
      .slice(late)
      .find((each) => each.ask.doc === 'c\0original')
      ?.answer({
        id: 1,
        doc: 'c',
        version: 0,
        from: 0,
        to: 0,
        total: 1,
        ...packLines([]),
        classes: [],
        done: true,
      });
  });

  it('colours a returning diff’s old side from tokens that arrived while it was away', () => {
    const fake = createTokens();
    const { session } = createSession({ tokens: fake.tokens });
    const host = createHost();
    session.show(host, input('a', 'const a', { original: 'let b' }));
    session.show(host, input('b', 'x'));
    fake.known.set('let b', { lines: [Uint32Array.from([3, 1, 5, 0])], classes: ['', 'tm-code-keyword'] });
    session.show(host, input('a', 'const a', { original: 'let b' }));
    expect(host.querySelector('.cm-deletedLine .tm-code-keyword')?.textContent).toBe('let');
  });

  it('shows a diff side by side in a merge view, and back to one editor after', () => {
    const { session } = createSession();
    const host = createHost();
    session.show(host, input('a', 'one\ntwo', { original: 'one\nold', split: true }));
    const views = session.views;
    expect(views?.a).not.toBeNull();
    expect(host.querySelector('.cm-mergeView')).not.toBeNull();
    session.show(host, input('a', 'one\ntwo', { original: 'one\nold', split: true }));
    session.show(host, input('b', 'plain'));
    expect(host.querySelector('.cm-mergeView')).toBeNull();
    expect(session.views?.a).toBeNull();
    session.show(host, input('c', 'x', { original: 'y', split: true }));
    session.hide(host);
    expect(host.querySelector('.cm-mergeView')).toBeNull();
  });

  it('keeps one merge view for every side by side diff and each diff’s edits, forgetting the oldest', async () => {
    const languages: string[] = [];
    const { session, idles } = createSession({
      limit: 2,
      language: (path) => {
        languages.push(path);
        return Promise.resolve(null);
      },
    });
    const host = createHost();
    session.show(host, input('a', 'one\ntwo', { original: 'one\nold', split: true }));
    const merge = host.querySelector('.cm-mergeView');
    session.views?.b.dispatch({ changes: { from: 0, insert: 'x' } });
    session.show(host, input('b', 'three', { original: 'four', split: true }));
    expect(host.querySelector('.cm-mergeView')).toBe(merge);
    expect(session.readText('a')).toBe('xone\ntwo');
    session.show(host, input('a', 'xone\ntwo', { original: 'one\nold', split: true }));
    expect(session.views?.b.state.doc.toString()).toBe('xone\ntwo');
    expect(session.views?.a?.state.doc.toString()).toBe('one\nold');
    session.show(host, input('a', 'xone\ntwo', { original: 'one\nold' }));
    for (const run of idles.splice(0)) run();
    await Bun.sleep(0);
    expect(languages).toEqual(['a.ts']);
    session.show(host, input('c', 'five', { original: 'six', split: true }));
    session.show(host, input('d', 'seven', { original: 'eight', split: true }));
    expect(session.readText('b')).toBeNull();
    session.hide(host);
    expect(host.querySelector('.cm-mergeView')).toBeNull();
    session.show(host, input('d', 'seven', { original: 'eight', split: true }));
    expect(host.querySelector('.cm-mergeView')).toBe(merge);
  });

  it('builds a pair ahead without touching the one shown, so its first view reuses it', () => {
    const { session } = createSession({ limit: 2 });
    const host = createHost();
    session.prefetchPair({ key: 'early', path: 'early.ts', content: 'new', original: 'old' });
    expect(host.querySelector('.cm-mergeView')).toBeNull();
    session.show(host, input('a', 'one\ntwo', { original: 'one\nold', split: true }));
    const shown = session.views?.b.state;
    session.prefetchPair({ key: 'a', path: 'a.ts', content: 'replaced', original: 'one\nold' });
    session.prefetchPair({ key: 'b', path: 'b.ts', content: 'three', original: 'four' });
    session.prefetchPair({ key: 'c', path: 'c.ts', content: 'five', original: 'six' });
    expect(session.views?.b.state).toBe(shown);
    expect(host.querySelector('.cm-changedLine')).not.toBeNull();
    expect(session.readText('a')).toBe('one\ntwo');
    expect(session.readText('b')).toBeNull();
    expect(session.readText('early')).toBeNull();
    const prefetched = session.readText('c');
    session.show(host, input('c', 'five', { original: 'six', split: true }));
    expect(prefetched).toBe('five');
    expect(session.views?.a?.state.doc.toString()).toBe('six');
    session.destroy();
    session.prefetchPair({ key: 'd', path: 'd.ts', content: 'x', original: 'y' });
    expect(session.readText('d')).toBeNull();
  });

  it('adds the language when the browser is idle, once per file, and indent folding without one', async () => {
    const support = await requestLanguage('a.json');
    const languages: string[] = [];
    const { session, idles } = createSession({
      language: (path) => {
        languages.push(path);
        return Promise.resolve(path.endsWith('.json') ? support : null);
      },
    });
    const host = createHost();
    session.show(host, input('a', '{"a": 1}', { path: 'a.json' }));
    idles.shift()?.();
    await Bun.sleep(0);
    session.show(host, input('b', 'x'));
    session.show(host, input('a', '{"a": 1}', { path: 'a.json' }));
    expect(idles).toHaveLength(1);
    idles.shift()?.();
    session.show(host, input('c', 'y'));
    idles.shift()?.();
    await Bun.sleep(0);
    expect(languages).toEqual(['a.json', 'c.ts']);
    session.show(host, input('d', 'z', { original: 'w', split: true }));
    session.destroy();
    idles.shift()?.();
    await Bun.sleep(0);
  });

  it('saves and comments on old lines through the page, and does nothing before a page is set', () => {
    const { session } = createSession();
    const host = createHost();
    session.show(host, input('a', 'one\ntwo', { original: 'zero\ntwo' }));
    const view = session.views?.b;
    const mac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    const save = () => new KeyboardEvent('keydown', { key: 's', metaKey: mac, ctrlKey: !mac });
    if (view) runScopeHandlers(view, save(), 'editor');
    view?.dispatch({ changes: { from: 0, insert: 'x' } });
    host.querySelector('.cm-oldLines > div')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    const calls: string[] = [];
    session.latest = {
      onComment: (side, line) => calls.push(`${side}:${line}`),
      onEdit: () => {},
      onSave: () => calls.push('save'),
    };
    if (view) runScopeHandlers(view, save(), 'editor');
    host.querySelector('.cm-oldLines > div')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(calls).toEqual(['save', 'old:1']);
  });

  it('waits for an idle moment by itself when no page schedules it', async () => {
    const scope = globalThis as { requestIdleCallback?: (run: () => void) => number };
    const paths: string[] = [];
    const language = (path: string) => {
      paths.push(path);
      return Promise.resolve(null);
    };
    const plain = new EditorSession({ language, tokens: createTokens().tokens });
    sessions.push(plain);
    plain.show(createHost(), input('a', 'x'));
    await Bun.sleep(40);
    const idle = scope.requestIdleCallback;
    scope.requestIdleCallback = (run) => {
      queueMicrotask(run);
      return 0;
    };
    const quick = new EditorSession({ language, tokens: createTokens().tokens });
    sessions.push(quick);
    quick.show(createHost(), input('b', 'y'));
    await Bun.sleep(0);
    if (idle) scope.requestIdleCallback = idle;
    else delete scope.requestIdleCallback;
    expect(paths).toEqual(['a.ts', 'b.ts']);
  });

  it('drops a language that arrives after the file was left', async () => {
    let finish: (support: LanguageSupport | null) => void = () => {};
    const { session, idles } = createSession({
      language: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const host = createHost();
    session.show(host, input('a', 'x'));
    idles.shift()?.();
    session.show(host, input('b', 'y'));
    finish(null);
    await Bun.sleep(0);
    expect(session.current).toBe('b');
  });
});
