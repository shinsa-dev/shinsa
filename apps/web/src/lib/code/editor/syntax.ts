import {
  type ChangeSet,
  type Extension,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Text,
} from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { isTokenFailure, type TokenAnswer, unpackLines } from './textmate.ts';
import type { TokenAsk, TokenClient, TokenSet } from './tokens.ts';

export interface TokenState {
  lines: readonly (Uint32Array | undefined)[];
  classes: readonly string[];
  version: number;
}

interface TokenUpdate {
  version: number;
  from: number;
  lines: readonly Uint32Array[];
  total: number;
  classes: readonly string[];
}

export interface SyntaxOptions {
  client: Pick<TokenClient, 'request'>;
  doc: string;
  grammar: string | null;
  initial: TokenSet | null;
  delayMs?: number;
}

export const applyTokens = StateEffect.define<TokenUpdate>();

const EMPTY: TokenState = { lines: [], classes: [''], version: 0 };

const EDIT_DELAY_MS = 30;

const marks = new Map<string, Decoration>();

function selectMark(className: string) {
  const known = marks.get(className);
  if (known) return known;
  const mark = Decoration.mark({ class: className });
  marks.set(className, mark);
  return mark;
}

export function mapTokenLines(
  lines: readonly (Uint32Array | undefined)[],
  changes: ChangeSet,
  before: Text,
  after: Text
) {
  const next: (Uint32Array | undefined)[] = [];
  let copied = 0;
  changes.iterChangedRanges((fromA, toA, _fromB, toB) => {
    const firstA = before.lineAt(fromA).number - 1;
    const lastA = before.lineAt(toA).number - 1;
    const lastB = after.lineAt(toB).number - 1;
    for (let index = copied; index < firstA; index += 1) next.push(lines[index]);
    while (next.length <= lastB) next.push(undefined);
    copied = Math.max(copied, lastA + 1);
  });
  for (let index = copied; index < before.lines; index += 1) next.push(lines[index]);
  return next;
}

export function resolveMissingLines(lines: readonly (Uint32Array | undefined)[], total: number) {
  let from = -1;
  let to = -1;
  for (let index = 0; index < total; index += 1) {
    if (lines[index] !== undefined) continue;
    if (from < 0) from = index;
    to = index + 1;
  }
  return from < 0 ? null : { from, to };
}

export const tokenField = StateField.define<TokenState>({
  create: () => EMPTY,
  update(value, transaction) {
    let next = value;
    if (transaction.docChanged) {
      next = {
        lines: mapTokenLines(
          value.lines,
          transaction.changes,
          transaction.startState.doc,
          transaction.state.doc
        ),
        classes: value.classes,
        version: value.version + 1,
      };
    }
    for (const effect of transaction.effects) {
      if (!effect.is(applyTokens) || effect.value.version !== next.version) continue;
      const lines = next.lines.slice(0, effect.value.total);
      for (const [index, line] of effect.value.lines.entries()) lines[effect.value.from + index] = line;
      next = { lines, classes: effect.value.classes, version: next.version };
    }
    return next;
  },
});

function buildTokenDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { lines, classes } = view.state.field(tokenField);
  const doc = view.state.doc;
  for (const { from, to } of view.visibleRanges) {
    for (let number = doc.lineAt(from).number; number <= doc.lines; number += 1) {
      const line = doc.line(number);
      if (line.from > to) break;
      const tokens = lines[number - 1];
      if (!tokens) continue;
      let start = line.from;
      for (let index = 0; index < tokens.length; index += 2) {
        const end = Math.min(line.to, line.from + (tokens[index] ?? 0));
        const className = classes[tokens[index + 1] ?? 0];
        if (className && end > start) builder.add(start, end, selectMark(className));
        start = Math.max(start, end);
      }
    }
  }
  return builder.finish();
}

class SyntaxView {
  decorations: DecorationSet;
  #cancel: (() => void) | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly view: EditorView,
    readonly options: SyntaxOptions
  ) {
    this.decorations = buildTokenDecorations(view);
    const field = view.state.field(tokenField);
    if (resolveMissingLines(field.lines, view.state.doc.lines)) this.#request(undefined);
  }

  update(update: ViewUpdate) {
    const changed = update.startState.field(tokenField) !== update.state.field(tokenField);
    if (update.docChanged) this.#schedule();
    if (changed || update.viewportChanged) this.decorations = buildTokenDecorations(update.view);
  }

  destroy() {
    this.#cancel?.();
    if (this.#timer) clearTimeout(this.#timer);
  }

  #schedule() {
    if (!this.options.grammar) return;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      const field = this.view.state.field(tokenField);
      this.#request(resolveMissingLines(field.lines, this.view.state.doc.lines));
    }, this.options.delayMs ?? EDIT_DELAY_MS);
  }

  #request(need: TokenAsk['need'] | undefined) {
    const grammar = this.options.grammar;
    if (!grammar) return;
    this.#cancel?.();
    const ask: TokenAsk = {
      doc: this.options.doc,
      grammar,
      text: this.view.state.doc.toString(),
      version: this.view.state.field(tokenField).version,
      ...(need === undefined ? {} : { need }),
    };
    this.#cancel = this.options.client.request(ask, (answer: TokenAnswer) => {
      if (isTokenFailure(answer)) return;
      this.view.dispatch({
        effects: applyTokens.of({
          version: answer.version,
          from: answer.from,
          lines: unpackLines(answer.offsets, answer.data),
          total: answer.total,
          classes: answer.classes,
        }),
      });
    });
  }
}

export function syntaxTokens(options: SyntaxOptions): Extension {
  const initial = options.initial;
  return [
    tokenField.init(() => (initial ? { lines: initial.lines, classes: initial.classes, version: 0 } : EMPTY)),
    ViewPlugin.define((view) => new SyntaxView(view, options), {
      decorations: (plugin) => plugin.decorations,
    }),
  ];
}
