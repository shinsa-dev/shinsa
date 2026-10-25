import { COMMENT_CLASS, COMMENT_TAGS, type CommentSpan, scanCommentLine } from '@/lib/code/comment-tags.ts';
import { resolveTokenClass } from '@/lib/code/grammar.ts';

export interface LineState {
  equals: (other: LineState) => boolean;
}

export interface LineGrammar {
  tokenizeLine2: (
    line: string,
    state: LineState | null,
    timeLimit?: number
  ) => { tokens: Uint32Array; ruleStack: LineState };
}

export interface GrammarEngine {
  initial: LineState;
  load: (grammar: string, text: string) => Promise<LineGrammar | null>;
  colors: () => readonly string[];
}

export interface TokenRequest {
  id: number;
  doc: string;
  grammar: string;
  text: string;
  version: number;
  known: boolean;
  need: { from: number; to: number } | null;
  priority: number;
}

export interface TokenReply {
  id: number;
  doc: string;
  version: number;
  from: number;
  to: number;
  total: number;
  offsets: Uint32Array;
  data: Uint32Array;
  classes: string[];
  done: boolean;
}

export interface TokenFailure {
  id: number;
  doc: string;
  version: number;
  failed: string;
}

export type TokenAnswer = TokenReply | TokenFailure;

interface Plan {
  lines: string[];
  state: DocState;
  start: number;
  reuseFrom: number;
  reusable: DocState | null;
}

interface Job {
  priority: number;
  done: Promise<void>;
}

interface DocState {
  grammar: string;
  text: string;
  lines: string[];
  states: LineState[];
  blocks: boolean[];
  tokens: Uint32Array[];
}

export const MAX_LINE_LENGTH = 20_000;

const LINE_TIME_LIMIT_MS = 500;

const SLICE_MS = 8;

const FIRST_SLICE_LINES = 120;

const DOC_LIMIT = 24;

const FOREGROUND_MASK = 0xff8000;

const FOREGROUND_OFFSET = 15;

const FONT_STYLE_MASK = 0x7800;

const FONT_STYLE_OFFSET = 11;

const DEFAULT_FOREGROUND = 1;

const EMPTY = new Uint32Array();

export function splitLines(text: string) {
  return text.split(/\r\n?|\n/);
}

export function isTokenFailure(answer: TokenAnswer): answer is TokenFailure {
  return 'failed' in answer;
}

function countCommonPrefix(a: readonly string[], b: readonly string[], limit: number) {
  let count = 0;
  while (count < limit && a[count] === b[count]) count += 1;
  return count;
}

function countCommonSuffix(a: readonly string[], b: readonly string[], limit: number) {
  let count = 0;
  while (count < limit && a.at(-1 - count) === b.at(-1 - count)) count += 1;
  return count;
}

export function packLines(lines: readonly Uint32Array[]) {
  const offsets = new Uint32Array(lines.length + 1);
  let size = 0;
  for (const [index, line] of lines.entries()) {
    offsets[index] = size;
    size += line.length;
  }
  offsets[lines.length] = size;
  const data = new Uint32Array(size);
  for (const [index, line] of lines.entries()) data.set(line, offsets[index] ?? 0);
  return { offsets, data };
}

export function unpackLines(offsets: Uint32Array, data: Uint32Array) {
  const lines: Uint32Array[] = [];
  for (let index = 0; index + 1 < offsets.length; index += 1)
    lines.push(data.subarray(offsets[index] ?? 0, offsets[index + 1] ?? 0));
  return lines;
}

export function createTokenizer(
  engine: GrammarEngine,
  post: (answer: TokenAnswer) => void,
  pause: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 0)),
  now: () => number = () => performance.now()
) {
  const docs = new Map<string, DocState>();
  const latest = new Map<string, number>();
  const waiting: { job: Job; start: () => void }[] = [];
  const jobs = new Map<string, Job>();
  let running = false;

  function queue(entry: { job: Job; start: () => void }) {
    const at = waiting.findIndex((each) => each.job.priority < entry.job.priority);
    waiting.splice(at < 0 ? waiting.length : at, 0, entry);
  }

  function takeTurn(job: Job) {
    if (!running) {
      running = true;
      return Promise.resolve();
    }
    return new Promise<void>((start) => queue({ job, start }));
  }

  function release() {
    void pause().then(() => {
      const next = waiting.shift();
      if (next) next.start();
      else running = false;
    });
  }

  function bump(job: Job, priority: number) {
    if (job.priority >= priority) return;
    job.priority = priority;
    const at = waiting.findIndex((each) => each.job === job);
    const [entry] = at >= 0 ? waiting.splice(at, 1) : [];
    if (entry) queue(entry);
  }

  function selectDonor(request: TokenRequest) {
    for (const state of docs.values()) {
      if (
        state.grammar === request.grammar &&
        state.tokens.length === state.lines.length &&
        state.text === request.text
      )
        return state;
    }
    return null;
  }
  const classes: string[] = [''];
  const classIndex = new Map<number, number>([[DEFAULT_FOREGROUND * 16, 0]]);

  function resolveClass(metadata: number) {
    const foreground = (metadata & FOREGROUND_MASK) >>> FOREGROUND_OFFSET;
    const fontStyle = (metadata & FONT_STYLE_MASK) >>> FONT_STYLE_OFFSET;
    const key = foreground * 16 + fontStyle;
    const known = classIndex.get(key);
    if (known !== undefined) return known;
    const color = foreground === DEFAULT_FOREGROUND ? undefined : engine.colors()[foreground];
    const name = resolveTokenClass(color, fontStyle);
    const index = name ? classes.length : 0;
    if (name) classes.push(name);
    classIndex.set(key, index);
    return index;
  }

  function encodeLine(line: string, tokens: Uint32Array) {
    const pairs: number[] = [];
    for (let index = 0; index < tokens.length; index += 2) {
      const end = tokens[index + 2] ?? line.length;
      const kind = resolveClass(tokens[index + 1] ?? 0);
      if (end <= (tokens[index] ?? 0)) continue;
      if (pairs.length > 0 && pairs.at(-1) === kind) pairs[pairs.length - 2] = end;
      else pairs.push(end, kind);
    }
    return pairs.length === 0 ? EMPTY : Uint32Array.from(pairs);
  }

  function resolveNamedClass(name: string) {
    const known = classes.indexOf(name);
    if (known >= 0) return known;
    classes.push(name);
    return classes.length - 1;
  }

  function tagComments(line: string, pairs: Uint32Array, plainBlock: boolean, first: boolean) {
    const comment = classes.indexOf(COMMENT_CLASS);
    const spans: CommentSpan[] = [];
    for (let index = 0, from = 0; index < pairs.length; index += 2) {
      const to = pairs[index] ?? from;
      if (pairs[index + 1] === comment) spans.push({ from, to });
      from = to;
    }
    if (spans.length === 0) return { tokens: pairs, plainBlock };
    const scan = scanCommentLine(line, spans, plainBlock, first);
    if (!scan.tagged) return { tokens: pairs, plainBlock: scan.plainBlock };
    const cut = scan.tagged.from;
    const tagged: number[] = [];
    for (let index = 0; index < pairs.length && (pairs[index - 2] ?? 0) < cut; index += 2)
      tagged.push(Math.min(pairs[index] ?? 0, cut), pairs[index + 1] ?? 0);
    tagged.push(line.length, resolveNamedClass(COMMENT_TAGS[scan.tagged.tag].className));
    return { tokens: Uint32Array.from(tagged), plainBlock: scan.plainBlock };
  }

  function remember(doc: string, state: DocState) {
    docs.delete(doc);
    docs.set(doc, state);
    if (docs.size > DOC_LIMIT) docs.delete(docs.keys().next().value ?? '');
  }

  function send(request: TokenRequest, from: number, lines: Uint32Array[], total: number, done: boolean) {
    const { offsets, data } = packLines(lines);
    post({
      id: request.id,
      doc: request.doc,
      version: request.version,
      from,
      to: from + lines.length,
      total,
      offsets,
      data,
      classes: [...classes],
      done,
    });
  }

  async function tokenize(request: TokenRequest) {
    latest.set(request.doc, request.id);
    const grammar = await engine.load(request.grammar, request.text).catch(() => null);
    if (!grammar) {
      post({ id: request.id, doc: request.doc, version: request.version, failed: 'no grammar' });
      return;
    }
    const key = `${request.grammar}\0${request.text}`;
    const twin = jobs.get(key);
    if (twin && !request.known) {
      bump(twin, request.priority);
      await twin.done;
    }
    const job: Job = { priority: request.priority, done: Promise.resolve() };
    job.done = (async () => {
      await takeTurn(job);
      try {
        await run(request, grammar, job);
      } finally {
        release();
      }
    })();
    jobs.set(key, job);
    await job.done;
    if (jobs.get(key) === job) jobs.delete(key);
  }

  function prepare(request: TokenRequest): Plan {
    const lines = splitLines(request.text);
    const known = docs.get(request.doc) ?? (request.known ? undefined : (selectDonor(request) ?? undefined));
    const previous = known?.grammar === request.grammar ? known : null;
    const done = previous ? previous.tokens.length : 0;
    const start = previous ? countCommonPrefix(previous.lines, lines, Math.min(done, lines.length)) : 0;
    const suffix = previous
      ? countCommonSuffix(previous.lines, lines, Math.min(previous.lines.length, lines.length) - start)
      : 0;
    const state: DocState = {
      grammar: request.grammar,
      text: request.text,
      lines,
      states: previous ? previous.states.slice(0, start) : [],
      blocks: previous ? previous.blocks.slice(0, start) : [],
      tokens: previous ? previous.tokens.slice(0, start) : [],
    };
    const reusable = previous !== null && done === previous.lines.length ? previous : null;
    return { lines, state, start, reuseFrom: lines.length - suffix, reusable };
  }

  function reuseRest(plan: Plan, index: number, stack: LineState) {
    const previous = plan.reusable;
    if (!previous || index < plan.reuseFrom || index <= plan.start) return false;
    const old = index + previous.lines.length - plan.lines.length;
    const block = plan.state.blocks.at(-1) ?? false;
    if (old <= 0 || !previous.states[old - 1]?.equals(stack) || previous.blocks[old - 1] !== block)
      return false;
    for (let reused = old; reused < previous.lines.length; reused += 1) {
      plan.state.tokens.push(previous.tokens[reused] ?? EMPTY);
      plan.state.states.push(previous.states[reused] ?? stack);
      plan.state.blocks.push(previous.blocks[reused] ?? block);
    }
    return true;
  }

  function tokenizeOne(grammar: LineGrammar, line: string, stack: LineState, state: DocState) {
    const block = state.blocks.at(-1) ?? false;
    if (line.length > MAX_LINE_LENGTH) {
      state.tokens.push(EMPTY);
      state.states.push(stack);
      state.blocks.push(block);
      return stack;
    }
    const result = grammar.tokenizeLine2(line, stack, LINE_TIME_LIMIT_MS);
    const tagged = tagComments(line, encodeLine(line, result.tokens), block, state.tokens.length === 0);
    state.tokens.push(tagged.tokens);
    state.states.push(result.ruleStack);
    state.blocks.push(tagged.plainBlock);
    return result.ruleStack;
  }

  async function run(request: TokenRequest, grammar: LineGrammar, job: Job) {
    if (latest.get(request.doc) !== request.id) return;
    const plan = prepare(request);
    const { lines, state } = plan;
    let stack = plan.start > 0 ? (state.states[plan.start - 1] ?? engine.initial) : engine.initial;
    let sent = request.known ? Math.min(plan.start, request.need?.from ?? plan.start) : 0;
    let end = lines.length;
    let sliceStart = now();
    let sliceLines = 0;
    for (let index = plan.start; index < lines.length; index += 1) {
      if (reuseRest(plan, index, stack)) {
        end = index;
        break;
      }
      stack = tokenizeOne(grammar, lines[index] ?? '', stack, state);
      sliceLines += 1;
      const first = sent === 0 && sliceLines >= FIRST_SLICE_LINES;
      if (!first && now() - sliceStart < SLICE_MS) continue;
      send(request, sent, state.tokens.slice(sent, index + 1), lines.length, false);
      sent = index + 1;
      remember(request.doc, state);
      release();
      await takeTurn(job);
      if (latest.get(request.doc) !== request.id) return;
      sliceStart = now();
      sliceLines = 0;
    }
    remember(request.doc, state);
    const last = request.known
      ? Math.max(end, Math.min(request.need?.to ?? 0, state.tokens.length))
      : state.tokens.length;
    send(request, sent, state.tokens.slice(sent, last), lines.length, true);
  }

  return {
    tokenize,
    forget: (doc: string) => {
      docs.delete(doc);
      latest.delete(doc);
    },
  };
}
