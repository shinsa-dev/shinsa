import { describe, expect, it } from 'bun:test';
import {
  createTokenizer,
  type GrammarEngine,
  isTokenFailure,
  type LineGrammar,
  type LineState,
  MAX_LINE_LENGTH,
  packLines,
  splitLines,
  type TokenAnswer,
  type TokenReply,
  type TokenRequest,
  unpackLines,
} from '@/lib/code/editor/textmate.ts';

class Depth implements LineState {
  constructor(readonly depth: number) {}

  equals(other: LineState): boolean {
    return other instanceof Depth && other.depth === this.depth;
  }
}

const COLORS = ['', '#000000', 'var(--code-keyword)', 'var(--code-string)', 'var(--code-number)'];

function encode(foreground: number, fontStyle = 0) {
  return (foreground << 15) | (fontStyle << 11);
}

let lines = 0;

const GRAMMAR: LineGrammar = {
  tokenizeLine2: (line, state) => {
    lines += 1;
    const before = (state as Depth).depth;
    const depth = before + (line.includes('{') ? 1 : 0) - (line.includes('}') ? 1 : 0);
    const colon = line.indexOf(':');
    const foreground = Math.min(before, 3) + 1;
    const tokens =
      colon > 0
        ? [0, encode(foreground), colon, encode(foreground), colon, encode(2, 2), colon + 1, encode(1)]
        : [0, encode(foreground)];
    return { tokens: Uint32Array.from(tokens), ruleStack: new Depth(depth) };
  },
};

function createEngine(): GrammarEngine {
  return {
    initial: new Depth(0),
    colors: () => COLORS,
    load: (grammar) => {
      if (grammar === 'broken') return Promise.reject(new Error('no'));
      return Promise.resolve(grammar === 'fake' ? GRAMMAR : null);
    },
  };
}

function ask(text: string, extra: Partial<TokenRequest> = {}): TokenRequest {
  return {
    id: 1,
    doc: 'a',
    grammar: 'fake',
    text,
    version: 0,
    known: false,
    need: null,
    priority: 1,
    ...extra,
  };
}

function createHarness(now: () => number = () => 0) {
  const answers: TokenAnswer[] = [];
  const tokenizer = createTokenizer(
    createEngine(),
    (answer) => answers.push(answer),
    () => Promise.resolve(),
    now
  );
  const replies = () => answers.filter((answer): answer is TokenReply => !isTokenFailure(answer));
  return { tokenizer, answers, replies };
}

function decode(reply: TokenReply) {
  return unpackLines(reply.offsets, reply.data).map((line) => [...line]);
}

describe('splitLines, packLines and unpackLines', () => {
  it('split the way the editor does and survive a round trip', () => {
    expect(splitLines('a\r\nb\rc\nd')).toEqual(['a', 'b', 'c', 'd']);
    const packed = packLines([Uint32Array.from([1, 2]), new Uint32Array(), Uint32Array.from([3, 4, 5, 6])]);
    expect([...packed.offsets]).toEqual([0, 2, 2, 6]);
    expect(unpackLines(packed.offsets, packed.data).map((line) => [...line])).toEqual([
      [1, 2],
      [],
      [3, 4, 5, 6],
    ]);
  });
});

describe('createTokenizer', () => {
  it('tokenizes every line into end and class pairs, merging neighbours of one class', async () => {
    const { tokenizer, replies } = createHarness();
    await tokenizer.tokenize(ask('a: b\n{\nx\n}\n'));
    const [reply] = replies();
    expect(reply?.done).toBe(true);
    expect(reply?.total).toBe(5);
    expect(reply?.classes).toEqual(['', 'tm-code-keyword tm-bold', 'tm-code-keyword']);
    expect(reply && decode(reply)).toEqual([[1, 0, 2, 1, 4, 0], [1, 0], [1, 2], [1, 2], []]);
  });

  it('works with the real clock and pauses', async () => {
    const answers: TokenAnswer[] = [];
    const tokenizer = createTokenizer(createEngine(), (answer) => answers.push(answer));
    await tokenizer.tokenize(ask('a\nb'));
    await Bun.sleep(5);
    expect(answers).toHaveLength(1);
  });

  it('answers a failure when there is no grammar or it does not load', async () => {
    const { tokenizer, answers } = createHarness();
    await tokenizer.tokenize(ask('a', { grammar: 'none' }));
    await tokenizer.tokenize(ask('a', { grammar: 'broken', id: 2 }));
    expect(answers).toEqual([
      { id: 1, doc: 'a', version: 0, failed: 'no grammar' },
      { id: 2, doc: 'a', version: 0, failed: 'no grammar' },
    ]);
  });

  it('sends the top of a long file first, then slices of work', async () => {
    const quick = createHarness();
    await quick.tokenizer.tokenize(ask(Array.from({ length: 130 }, () => 'x').join('\n')));
    expect(quick.replies().map((reply) => [reply.from, reply.to, reply.done])).toEqual([
      [0, 120, false],
      [120, 130, true],
    ]);
    let clock = 0;
    const slow = createHarness(() => {
      clock += 5;
      return clock;
    });
    await slow.tokenizer.tokenize(ask('a\nb\nc\nd'));
    expect(slow.replies().map((reply) => [reply.from, reply.to])).toEqual([
      [0, 2],
      [2, 4],
      [4, 4],
    ]);
  });

  it('leaves a line too long to tokenize plain, as VS Code does', async () => {
    const { tokenizer, replies } = createHarness();
    await tokenizer.tokenize(ask(`${'x'.repeat(MAX_LINE_LENGTH + 1)}\nok`));
    const reply = replies()[0];
    expect(reply && decode(reply)).toEqual([[], [2, 0]]);
  });

  it('tokenizes only what an edit changed, and sends what the editor is missing', async () => {
    const { tokenizer, replies } = createHarness();
    const text = ['{', 'a', 'b', 'c', '}', 'd', 'e'].join('\n');
    await tokenizer.tokenize(ask(text));
    lines = 0;
    await tokenizer.tokenize(ask(text.replace('b', 'bb'), { id: 2, version: 1, known: true }));
    expect(lines).toBe(1);
    expect(replies().at(-1)).toMatchObject({ id: 2, from: 2, to: 3, total: 7, done: true });
    await tokenizer.tokenize(
      ask(text.replace('b', 'bbb'), { id: 3, version: 2, known: true, need: { from: 5, to: 7 } })
    );
    expect(replies().at(-1)).toMatchObject({ id: 3, from: 2, to: 7 });
    lines = 0;
    await tokenizer.tokenize(ask(text.replace('{', 'x'), { id: 4, version: 3, known: true }));
    expect(lines).toBe(7);
    await tokenizer.tokenize(ask(`${text}\nmore`, { id: 5, grammar: 'fake', known: false }));
    expect(replies().at(-1)).toMatchObject({ id: 5, from: 0, to: 8 });
  });

  it('stops a job an edit has overtaken', async () => {
    const answers: TokenAnswer[] = [];
    let clock = 0;
    const pauses: (() => void)[] = [];
    const tokenizer = createTokenizer(
      createEngine(),
      (answer) => answers.push(answer),
      () => new Promise<void>((resolve) => pauses.push(resolve)),
      () => {
        clock += 10;
        return clock;
      }
    );
    const first = tokenizer.tokenize(ask('a\nb\nc\nd'));
    await Bun.sleep(0);
    const second = tokenizer.tokenize(ask('a\nb\nc\nd\ne', { id: 2 }));
    while (pauses.length > 0 || answers.every((answer) => !('done' in answer) || !answer.done)) {
      pauses.shift()?.();
      await Bun.sleep(0);
    }
    await Promise.all([first, second]);
    const done = answers.filter((answer) => 'done' in answer && answer.done).map((answer) => answer.id);
    expect(done).toEqual([2]);
    tokenizer.forget('a');
  });

  it('lets the file on screen go ahead of prefetching, and joins a prefetch of the same text', async () => {
    const answers: TokenAnswer[] = [];
    let clock = 0;
    const tokenizer = createTokenizer(
      createEngine(),
      (answer) => answers.push(answer),
      () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
      () => {
        clock += 10;
        return clock;
      }
    );
    const long = Array.from({ length: 6 }, (_, index) => `line ${index}`).join('\n');
    const background = tokenizer.tokenize(ask(long, { doc: 'other', priority: 0 }));
    const twin = tokenizer.tokenize(ask('x\ny\nz', { doc: 'prefetch:x', id: 2, priority: 0 }));
    const visible = tokenizer.tokenize(ask('x\ny\nz', { doc: 'x', id: 3, priority: 1 }));
    await Promise.all([background, twin, visible]);
    const order = answers.filter((answer) => 'done' in answer && answer.done).map((answer) => answer.id);
    expect(order.indexOf(3)).toBeLessThan(order.indexOf(1));
    expect(answers.find((answer) => answer.id === 3 && 'from' in answer)).toMatchObject({ from: 0, to: 3 });
  });
});
