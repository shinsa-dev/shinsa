import { resolveGrammar } from '@/lib/code/grammar.ts';
import { isTokenFailure, type TokenAnswer, type TokenRequest, unpackLines } from './textmate.ts';

export interface TokenSet {
  lines: readonly (Uint32Array | undefined)[];
  classes: readonly string[];
}

export interface TokenWorker {
  postMessage: (request: TokenRequest) => void;
  onmessage: ((event: MessageEvent<TokenAnswer>) => void) | null;
}

export interface TokenAsk {
  doc: string;
  grammar: string;
  text: string;
  version: number;
  need?: { from: number; to: number } | null;
  priority?: number;
}

interface Cached {
  grammar: string;
  text: string;
}

export const PREFETCH_TOKEN_CHARS = 400_000;

export const TOKEN_PRIORITY = { prefetch: 0, visible: 1 } as const;

const CACHE_CHARS = 32 * 1024 * 1024;

export function readFirstLine(text: string) {
  const end = text.indexOf('\n');
  return end < 0 ? text : text.slice(0, end);
}

export function resolveTextGrammar(path: string, text: string) {
  return resolveGrammar(path, readFirstLine(text));
}

export function createTokenWorker(): TokenWorker {
  return new Worker(new URL('./tokenize.worker.ts', import.meta.url), { type: 'module' });
}

export class TokenClient {
  readonly #create: () => TokenWorker;
  #worker: TokenWorker | null = null;
  #next = 0;
  readonly #listeners = new Map<number, (answer: TokenAnswer) => void>();
  readonly #cache = new Map<string, Map<string, TokenSet>>();
  readonly #order: Cached[] = [];
  #chars = 0;
  readonly #pending = new Map<string, Set<string>>();

  constructor(create: () => TokenWorker = createTokenWorker) {
    this.#create = create;
  }

  warm() {
    this.#start();
  }

  select(grammar: string, text: string): TokenSet | null {
    return this.#cache.get(grammar)?.get(text) ?? null;
  }

  request(ask: TokenAsk, onAnswer: (answer: TokenAnswer) => void) {
    const worker = this.#start();
    this.#next += 1;
    const id = this.#next;
    const known = ask.need !== undefined;
    const lines: (Uint32Array | undefined)[] = [];
    this.#listeners.set(id, (answer) => {
      if (!isTokenFailure(answer)) {
        const received = unpackLines(answer.offsets, answer.data);
        for (const [index, line] of received.entries()) lines[answer.from + index] = line;
        if (answer.done) this.#listeners.delete(id);
        if (answer.done && !known) this.#remember(ask.grammar, ask.text, { lines, classes: answer.classes });
      } else this.#listeners.delete(id);
      onAnswer(answer);
    });
    worker.postMessage({
      id,
      doc: ask.doc,
      grammar: ask.grammar,
      text: ask.text,
      version: ask.version,
      known,
      need: ask.need ?? null,
      priority: ask.priority ?? TOKEN_PRIORITY.visible,
    });
    return () => {
      this.#listeners.delete(id);
    };
  }

  prefetch(path: string, text: string, priority: number = TOKEN_PRIORITY.prefetch) {
    const grammar = resolveTextGrammar(path, text);
    if (!grammar || text.length > PREFETCH_TOKEN_CHARS || this.select(grammar, text)) return;
    const pending = this.#pending.get(grammar) ?? new Set<string>();
    if (pending.has(text)) return;
    pending.add(text);
    this.#pending.set(grammar, pending);
    this.request({ doc: `prefetch:${path}`, grammar, text, version: 0, priority }, (answer) => {
      if (isTokenFailure(answer) || answer.done) pending.delete(text);
    });
  }

  #start() {
    if (this.#worker) return this.#worker;
    const worker = this.#create();
    worker.onmessage = (event) => this.#listeners.get(event.data.id)?.(event.data);
    this.#worker = worker;
    return worker;
  }

  #remember(grammar: string, text: string, set: TokenSet) {
    const texts = this.#cache.get(grammar) ?? new Map<string, TokenSet>();
    if (texts.has(text)) return;
    texts.set(text, set);
    this.#cache.set(grammar, texts);
    this.#order.push({ grammar, text });
    this.#chars += text.length;
    while (this.#chars > CACHE_CHARS && this.#order.length > 1) {
      const oldest = this.#order.shift();
      if (!oldest) break;
      this.#cache.get(oldest.grammar)?.delete(oldest.text);
      this.#chars -= oldest.text.length;
    }
  }
}

export const tokenClient = new TokenClient();
