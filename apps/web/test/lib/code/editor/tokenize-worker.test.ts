import { afterAll, describe, expect, it } from 'bun:test';
import type { TokenAnswer, TokenRequest } from '@/lib/code/editor/textmate.ts';

interface Scope {
  postMessage: unknown;
  onmessage: unknown;
}

const scope = globalThis as unknown as Scope;
const original = { postMessage: scope.postMessage, onmessage: scope.onmessage };
const posted: { answer: TokenAnswer; transfer: unknown[] }[] = [];
scope.postMessage = (answer: TokenAnswer, transfer: unknown[]) => posted.push({ answer, transfer });
await import('@/lib/code/editor/tokenize.worker.ts');
const handle = scope.onmessage as (event: { data: TokenRequest }) => void;

afterAll(() => {
  scope.postMessage = original.postMessage;
  scope.onmessage = original.onmessage;
});

function request(grammar: string, id: number): TokenRequest {
  return {
    id,
    doc: grammar,
    grammar,
    text: 'const a = 1;',
    version: 0,
    known: false,
    need: null,
    priority: 1,
  };
}

describe('the tokenizer worker', () => {
  it('answers each request, handing over its buffers, and fails plainly without a grammar', async () => {
    handle({ data: request('typescript', 1) });
    handle({ data: request('klingon', 2) });
    const has = (id: number) =>
      posted.some((each) => each.answer.id === id && (!('done' in each.answer) || each.answer.done));
    for (let attempt = 0; attempt < 800 && !(has(1) && has(2)); attempt += 1) await Bun.sleep(10);
    const done = posted.find((each) => each.answer.id === 1);
    expect(done?.transfer).toHaveLength(2);
    expect(posted.find((each) => each.answer.id === 2)).toEqual({
      answer: { id: 2, doc: 'klingon', version: 0, failed: 'no grammar' },
      transfer: [],
    });
  });
});
