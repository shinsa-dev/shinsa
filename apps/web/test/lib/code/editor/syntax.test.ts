import { describe, expect, it } from 'bun:test';
import { ChangeSet, EditorState, Text } from '@codemirror/state';
import {
  applyTokens,
  mapTokenLines,
  resolveMissingLines,
  syntaxTokens,
  tokenField,
} from '@/lib/code/editor/syntax.ts';
import { packLines, type TokenAnswer } from '@/lib/code/editor/textmate.ts';
import type { TokenAsk, TokenSet } from '@/lib/code/editor/tokens.ts';
import { createView } from './support.ts';

function line(...values: number[]) {
  return Uint32Array.from(values);
}

function createClient() {
  const asks: { ask: TokenAsk; answer: (answer: TokenAnswer) => void; cancelled: boolean }[] = [];
  return {
    asks,
    client: {
      request: (ask: TokenAsk, answer: (answer: TokenAnswer) => void) => {
        const entry = { ask, answer, cancelled: false };
        asks.push(entry);
        return () => {
          entry.cancelled = true;
        };
      },
    },
  };
}

function createAnswer(version: number, from: number, lines: Uint32Array[], total: number): TokenAnswer {
  return {
    id: 1,
    doc: 'a',
    version,
    from,
    to: from + lines.length,
    total,
    ...packLines(lines),
    classes: ['', 'tm-code-keyword'],
    done: true,
  };
}

describe('mapTokenLines', () => {
  it('keeps the tokens of untouched lines and forgets the lines an edit touched', () => {
    const before = Text.of(['a', 'b', 'c', 'd']);
    const lines = [line(1), line(2), line(3), line(4)];
    const insert = ChangeSet.of([{ from: 2, insert: 'x\ny\n' }], before.length);
    const after = insert.apply(before);
    expect(mapTokenLines(lines, insert, before, after)).toEqual([
      line(1),
      undefined,
      undefined,
      undefined,
      line(3),
      line(4),
    ]);
    const twice = ChangeSet.of(
      [
        { from: 0, insert: 'z' },
        { from: 1, insert: 'q' },
        { from: 6, to: 7, insert: '' },
      ],
      before.length
    );
    expect(mapTokenLines(lines, twice, before, twice.apply(before))).toEqual([
      undefined,
      line(2),
      line(3),
      undefined,
    ]);
  });
});

describe('resolveMissingLines', () => {
  it('spans the first to the last line without tokens', () => {
    expect(resolveMissingLines([line(1), line(2)], 2)).toBeNull();
    expect(resolveMissingLines([line(1), undefined, line(2), undefined], 5)).toEqual({ from: 1, to: 5 });
  });
});

describe('tokenField', () => {
  it('applies tokens for the version they were asked for, and drops late ones', () => {
    const state = EditorState.create({ doc: 'a\nb', extensions: tokenField });
    const set = state.update({
      effects: applyTokens.of({
        version: 0,
        from: 0,
        lines: [line(1, 1), line(1, 1)],
        total: 2,
        classes: ['', 'k'],
      }),
    }).state;
    expect(set.field(tokenField).lines).toHaveLength(2);
    const edited = set.update({ changes: { from: 0, insert: 'x' } }).state;
    expect(edited.field(tokenField).version).toBe(1);
    const late = edited.update({
      effects: applyTokens.of({ version: 0, from: 0, lines: [line(2, 1)], total: 2, classes: ['', 'k'] }),
    }).state;
    expect(late.field(tokenField).lines[0]).toBeUndefined();
  });
});

describe('syntaxTokens', () => {
  it('asks for tokens, colours the lines in view and never asks without a grammar', () => {
    const fake = createClient();
    const view = createView('const a\nb', [
      syntaxTokens({ client: fake.client, doc: 'a', grammar: 'typescript', initial: null }),
    ]);
    expect(fake.asks[0]?.ask).toEqual({ doc: 'a', grammar: 'typescript', text: 'const a\nb', version: 0 });
    fake.asks[0]?.answer({ id: 1, doc: 'a', version: 0, failed: 'no grammar' });
    fake.asks[0]?.answer(createAnswer(0, 0, [line(5, 1, 7, 0), line(1, 0)], 2));
    expect(view.dom.querySelector('.tm-code-keyword')?.textContent).toBe('const');
    const plain = createClient();
    createView('x', [syntaxTokens({ client: plain.client, doc: 'b', grammar: null, initial: null })]);
    expect(plain.asks).toHaveLength(0);
  });

  it('starts from cached tokens and asks again only for what an edit changed', async () => {
    const fake = createClient();
    const initial: TokenSet = { lines: [line(5, 1), line(1, 0)], classes: ['', 'tm-code-keyword'] };
    const view = createView('const\nb', [
      syntaxTokens({ client: fake.client, doc: 'a', grammar: 'typescript', initial, delayMs: 1 }),
    ]);
    expect(fake.asks).toHaveLength(0);
    expect(view.dom.querySelector('.tm-code-keyword')).not.toBeNull();
    view.dispatch({ changes: { from: 6, insert: 'x' } });
    view.dispatch({ changes: { from: 7, insert: 'y' } });
    await Bun.sleep(10);
    expect(fake.asks).toHaveLength(1);
    expect(fake.asks[0]?.ask).toMatchObject({ text: 'const\nxyb', version: 2, need: { from: 1, to: 2 } });
    view.dispatch({ changes: { from: 0, insert: '\n' } });
    await Bun.sleep(10);
    expect(fake.asks[0]?.cancelled).toBe(true);
    view.destroy();
    expect(fake.asks.at(-1)?.cancelled).toBe(true);
  });

  it('stops a pending edit request when the editor goes', async () => {
    const fake = createClient();
    const view = createView('a', [
      syntaxTokens({ client: fake.client, doc: 'a', grammar: 'typescript', initial: null, delayMs: 5 }),
    ]);
    view.dispatch({ changes: { from: 0, insert: 'b' } });
    view.destroy();
    await Bun.sleep(15);
    expect(fake.asks).toHaveLength(1);
  });
});
