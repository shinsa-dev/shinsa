import type { LanguageSupport } from '@codemirror/language';
import { Annotation, Compartment, EditorState, type Extension, type StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { CommentSide } from '@shinsa/core';
import { resolveCommentRange } from '@/lib/code/notes.ts';
import type { PairSource } from '@/lib/code/pane.ts';
import {
  annotationsField,
  type EditorAnnotations,
  NO_ANNOTATIONS,
  resolveSelectedLines,
} from './annotations.ts';
import { pinBlocksToGutter, skipCollapsedLines } from './collapsed.ts';
import { FindHost } from './find.ts';
import { createChevronMarkers, indentFolding } from './folding.ts';
import { type SplitPair, SplitView } from './merge.ts';
import { createEditorExtensions } from './setup.ts';
import { SlotRegistry } from './slots.ts';
import { SpotHintRegistry } from './spot-hints.ts';
import { syntaxTokens } from './syntax.ts';
import { resolveTextGrammar, type TokenClient, type TokenSet, tokenClient } from './tokens.ts';
import { setOriginalTokens, unifiedDiff } from './unified.ts';

export const fromDisk = Annotation.define<boolean>();

export interface SessionCallbacks {
  onComment: ((side: CommentSide, line: number, endLine: number | null) => void) | null;
  onEdit: () => void;
  onSave: () => void;
}

export interface ShowInput {
  key: string;
  path: string;
  content: string;
  original: string | null;
  split: boolean;
  annotations: { a: EditorAnnotations; b: EditorAnnotations };
}

export interface SessionViews {
  a: EditorView | null;
  b: EditorView;
}

export interface SessionOptions {
  language: (path: string) => Promise<LanguageSupport | null>;
  tokens?: Pick<TokenClient, 'request' | 'select'>;
  limit?: number;
  idle?: (run: () => void) => void;
}

interface Attachable {
  key: string;
  path: string;
  attached: boolean;
}

interface Entry extends Attachable {
  original: string | null;
  state: EditorState;
  scroll: StateEffect<unknown> | null;
}

interface Pair extends Attachable, SplitPair {
  original: string;
}

const ENTRY_LIMIT = 24;

function scheduleIdle(run: () => void) {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 250 });
  else setTimeout(run, 16);
}

export function isSameText(state: EditorState, text: string) {
  return state.doc.length === text.length && state.doc.toString() === text;
}

export class EditorSession {
  readonly registry = new SlotRegistry();
  readonly spotHints = new SpotHintRegistry();
  readonly findHost = new FindHost();
  readonly editable = new Compartment();
  readonly language = new Compartment();
  latest: SessionCallbacks = { onComment: null, onEdit: () => undefined, onSave: () => undefined };
  chevronMarkup = '';
  readonly #options: SessionOptions;
  readonly #tokens: Pick<TokenClient, 'request' | 'select'>;
  readonly #entries = new Map<string, Entry>();
  readonly #pairs = new Map<string, Pair>();
  readonly #markers = createChevronMarkers(() => this.chevronMarkup);
  #view: EditorView | null = null;
  #frame: HTMLDivElement | null = null;
  #split: SplitView | null = null;
  #splitShown = false;
  #shown: Attachable | null = null;
  #current: string | null = null;
  #destroyed = false;

  constructor(options: SessionOptions) {
    this.#options = options;
    this.#tokens = options.tokens ?? tokenClient;
  }

  get views(): SessionViews | null {
    if (this.#current === null) return null;
    if (this.#splitShown && this.#split) return { a: this.#split.merge.a, b: this.#split.merge.b };
    return this.#view ? { a: null, b: this.#view } : null;
  }

  get current() {
    return this.#current;
  }

  get chunks() {
    return this.#splitShown && this.#split ? this.#split.merge.chunks : [];
  }

  selectView(key: string) {
    return this.#current === key ? (this.views?.b ?? null) : null;
  }

  readText(key: string) {
    const view = this.selectView(key);
    if (view) return view.state.doc.toString();
    return (this.#entries.get(key)?.state ?? this.#pairs.get(key)?.b)?.doc.toString() ?? null;
  }

  show(host: HTMLElement, input: ShowInput) {
    this.#remember();
    this.#current = input.key;
    if (input.split && input.original !== null) this.#showSplit(host, input, input.original);
    else this.#showSingle(host, input);
  }

  prefetchPair(source: PairSource) {
    if (this.#destroyed || source.key === this.#current) return;
    this.#split ??= new SplitView();
    this.#selectPair(this.#split, {
      ...source,
      split: true,
      annotations: { a: NO_ANNOTATIONS, b: NO_ANNOTATIONS },
    });
  }

  hide(host: HTMLElement) {
    this.#remember();
    if (this.#frame?.parentElement === host) this.#frame.remove();
    if (this.#split?.merge.dom.parentElement === host) this.#split.merge.dom.remove();
    this.#current = null;
    this.#shown = null;
  }

  destroy() {
    this.#destroyed = true;
    this.#split?.merge.destroy();
    this.#view?.destroy();
    this.#split = null;
    this.#view = null;
    this.#frame = null;
    this.#entries.clear();
    this.#pairs.clear();
    this.#current = null;
    this.#shown = null;
  }

  #remember() {
    if (this.#current === null) return;
    if (this.#splitShown) {
      const pair = this.#pairs.get(this.#current);
      if (pair && this.#split) this.#split.remember(pair);
      return;
    }
    const view = this.#view;
    const entry = this.#entries.get(this.#current);
    if (!view || !entry) return;
    entry.state = view.state;
    entry.scroll = view.scrollSnapshot();
  }

  #showSingle(host: HTMLElement, input: ShowInput) {
    this.#split?.merge.dom.remove();
    this.#splitShown = false;
    const view = this.#ensureView();
    const frame = this.#frame as HTMLDivElement;
    if (frame.parentElement !== host) host.appendChild(frame);
    const entry = this.#selectEntry(input);
    this.#shown = entry;
    view.setState(entry.state);
    if (entry.scroll) view.dispatch({ effects: entry.scroll });
    if (input.original !== null) this.#requestOriginalTokens(view, input, input.original);
    this.#scheduleLanguage(entry, [view]);
  }

  #showSplit(host: HTMLElement, input: ShowInput, original: string) {
    this.#frame?.remove();
    this.#split ??= new SplitView();
    const split = this.#split;
    if (split.merge.dom.parentElement !== host) host.appendChild(split.merge.dom);
    this.#splitShown = true;
    const pair = this.#selectPair(split, { ...input, original });
    this.#shown = pair;
    split.show(pair);
    this.#scheduleLanguage(pair, [split.merge.a, split.merge.b]);
  }

  #selectPair(split: SplitView, input: ShowInput & { original: string }) {
    const original = input.original;
    const known = this.#pairs.get(input.key);
    if (known && known.original === original && isSameText(known.b, input.content)) {
      this.#keep(this.#pairs, known);
      return known;
    }
    const pair: Pair = {
      key: input.key,
      path: input.path,
      original,
      attached: false,
      ...split.createPair(original, input.content, {
        a: this.#extensions('old', input, false),
        b: this.#extensions('new', input, false),
      }),
    };
    this.#keep(this.#pairs, pair);
    return pair;
  }

  #keep<T>(store: Map<string, T>, value: T & { key: string }) {
    store.delete(value.key);
    store.set(value.key, value);
    for (const [key] of store) {
      if (store.size <= (this.#options.limit ?? ENTRY_LIMIT)) break;
      if (key !== value.key && key !== this.#current) store.delete(key);
    }
  }

  #ensureView() {
    if (this.#view) return this.#view;
    const frame = document.createElement('div');
    frame.className = 'flex min-h-0 flex-1 flex-col';
    this.#frame = frame;
    this.#view = new EditorView({ parent: frame });
    return this.#view;
  }

  #selectEntry(input: ShowInput) {
    const known = this.#entries.get(input.key);
    if (known && known.original === input.original && isSameText(known.state, input.content)) {
      this.#keep(this.#entries, known);
      return known;
    }
    const entry: Entry = {
      key: input.key,
      path: input.path,
      original: input.original,
      state: EditorState.create({
        doc: input.content,
        extensions: this.#extensions('new', input, input.original !== null),
      }),
      scroll: null,
      attached: false,
    };
    this.#keep(this.#entries, entry);
    return entry;
  }

  #extensions(side: CommentSide, input: ShowInput, unified: boolean): Extension[] {
    const text = side === 'old' ? (input.original ?? '') : input.content;
    const grammar = resolveTextGrammar(input.path, text);
    const tokens = grammar ? this.#tokens.select(grammar, text) : null;
    const extensions: Extension[] = [
      createEditorExtensions({
        language: null,
        editable: side === 'new' ? this.editable : new Compartment(),
        onLine: (line, view) => this.#comment(side, line, view),
        findPanel: this.findHost.createPanel,
        actions: () => ({ save: () => this.latest.onSave(), openFind: this.findHost.open }),
        markers: this.#markers,
      }),
      this.language.of(indentFolding),
      skipCollapsedLines,
      pinBlocksToGutter,
      annotationsField(
        this.registry,
        side === 'new' ? input.annotations.b : input.annotations.a,
        this.spotHints
      ),
      syntaxTokens({ client: this.#tokens, doc: `${input.key}\0${side}`, grammar, initial: tokens }),
    ];
    if (side === 'new') extensions.push(this.#changes());
    if (unified && input.original !== null) {
      extensions.push(
        unifiedDiff({
          original: input.original,
          tokens: grammar ? this.#tokens.select(grammar, input.original) : null,
          registry: this.registry,
          collapse: true,
          annotations: input.annotations.b,
          onOldLine: (line) => this.latest.onComment?.('old', line, null),
        })
      );
    }
    return extensions;
  }

  #changes() {
    return EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      if (update.transactions.some((transaction) => !transaction.annotation(fromDisk))) this.latest.onEdit();
    });
  }

  #comment(side: CommentSide, line: number, view: EditorView) {
    const onComment = this.latest.onComment;
    if (!onComment) return false;
    const range = resolveCommentRange(line, resolveSelectedLines(view));
    onComment(side, range.line, range.endLine);
    return true;
  }

  #requestOriginalTokens(view: EditorView, input: ShowInput, original: string) {
    const grammar = resolveTextGrammar(input.path, original);
    if (!grammar) return;
    const apply = (tokens: TokenSet) => {
      if (this.#current === input.key && !this.#destroyed)
        view.dispatch({ effects: setOriginalTokens.of(tokens) });
    };
    const known = this.#tokens.select(grammar, original);
    if (known) {
      apply(known);
      return;
    }
    this.#tokens.request({ doc: `${input.key}\0original`, grammar, text: original, version: 0 }, (answer) => {
      if (!('done' in answer) || !answer.done) return;
      const tokens = this.#tokens.select(grammar, original);
      if (tokens) apply(tokens);
    });
  }

  #scheduleLanguage(entry: Attachable, views: EditorView[]) {
    if (entry.attached) return;
    const idle = this.#options.idle ?? scheduleIdle;
    idle(() => {
      if (this.#destroyed || this.#shown !== entry) return;
      void this.#options.language(entry.path).then((support) => {
        if (this.#destroyed || this.#shown !== entry || entry.attached) return;
        entry.attached = true;
        for (const view of views)
          view.dispatch({ effects: this.language.reconfigure(support ?? indentFolding) });
      });
    });
  }
}
