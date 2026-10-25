import { describe, expect, it } from 'bun:test';
import { packLines, type TokenAnswer, type TokenRequest } from '@/lib/code/editor/textmate.ts';
import {
  createTokenWorker,
  PREFETCH_TOKEN_CHARS,
  readFirstLine,
  resolveTextGrammar,
  TOKEN_PRIORITY,
  TokenClient,
  type TokenWorker,
} from '@/lib/code/editor/tokens.ts';

function createFakeWorker() {
  const requests: TokenRequest[] = [];
  const worker: TokenWorker = {
    postMessage: (request) => requests.push(request),
    onmessage: null,
  };
  const answer = (value: Partial<TokenAnswer> & { id: number }) =>
    worker.onmessage?.({ data: value } as MessageEvent<TokenAnswer>);
  return { worker, requests, answer };
}

function reply(id: number, from: number, lines: number[][], done: boolean, total = from + lines.length) {
  const packed = packLines(lines.map((line) => Uint32Array.from(line)));
  return {
    id,
    doc: 'a',
    version: 0,
    from,
    to: from + lines.length,
    total,
    ...packed,
    classes: ['', 'k'],
    done,
  };
}

describe('resolveTextGrammar', () => {
  it('reads the grammar from the path, then from the first line', () => {
    expect(readFirstLine('a\nb')).toBe('a');
    expect(readFirstLine('only')).toBe('only');
    expect(resolveTextGrammar('a.ts', '')).toBe('typescript');
    expect(resolveTextGrammar('bin/run', '#!/bin/sh\necho')).toBe('shellscript');
  });
});

describe('TokenClient', () => {
  it('starts one worker, sends requests with their priority, and caches a whole answer', () => {
    const fake = createFakeWorker();
    let created = 0;
    const client = new TokenClient(() => {
      created += 1;
      return fake.worker;
    });
    client.warm();
    client.warm();
    expect(created).toBe(1);
    const seen: TokenAnswer[] = [];
    client.request({ doc: 'a', grammar: 'typescript', text: 'x\ny', version: 0 }, (answer) =>
      seen.push(answer)
    );
    expect(fake.requests[0]).toMatchObject({ known: false, need: null, priority: TOKEN_PRIORITY.visible });
    fake.answer(reply(1, 0, [[1, 1]], false, 2));
    expect(client.select('typescript', 'x\ny')).toBeNull();
    fake.answer(reply(1, 1, [[1, 0]], true));
    expect(seen).toHaveLength(2);
    expect(client.select('typescript', 'x\ny')?.lines.map((line) => [...(line ?? [])])).toEqual([
      [1, 1],
      [1, 0],
    ]);
    fake.answer(reply(1, 0, [[9, 9]], true));
    expect(seen).toHaveLength(2);
  });

  it('keeps an edit’s answer out of the cache, drops failures and stops listening when cancelled', () => {
    const fake = createFakeWorker();
    const client = new TokenClient(() => fake.worker);
    const seen: TokenAnswer[] = [];
    client.request({ doc: 'a', grammar: 'json', text: '{}', version: 1, need: null }, (answer) =>
      seen.push(answer)
    );
    expect(fake.requests[0]).toMatchObject({ known: true });
    fake.answer(reply(1, 0, [[2, 1]], true));
    expect(client.select('json', '{}')).toBeNull();
    client.request({ doc: 'b', grammar: 'json', text: '[]', version: 0 }, (answer) => seen.push(answer));
    fake.answer({ id: 2, doc: 'b', version: 0, failed: 'no grammar' } as TokenAnswer);
    const cancel = client.request({ doc: 'c', grammar: 'json', text: '1', version: 0 }, (answer) =>
      seen.push(answer)
    );
    cancel();
    fake.answer(reply(3, 0, [[1, 1]], true));
    expect(seen.map((answer) => answer.id)).toEqual([1, 2]);
  });

  it('prefetches tokens once per text, never for plain or huge files, and forgets the oldest first', () => {
    const fake = createFakeWorker();
    const client = new TokenClient(() => fake.worker);
    client.prefetch('notes.txt', 'plain');
    client.prefetch('a.ts', 'x'.repeat(PREFETCH_TOKEN_CHARS + 1));
    client.prefetch('a.ts', 'const a = 1;');
    client.prefetch('b.ts', 'const a = 1;');
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({ doc: 'prefetch:a.ts', priority: TOKEN_PRIORITY.prefetch });
    fake.answer(reply(1, 0, [[5, 1]], true));
    client.prefetch('a.ts', 'const a = 1;', TOKEN_PRIORITY.visible);
    expect(fake.requests).toHaveLength(1);
    client.prefetch('c.ts', 'let b;', TOKEN_PRIORITY.visible);
    expect(fake.requests[1]).toMatchObject({ priority: TOKEN_PRIORITY.visible });
    fake.answer({ id: 2, doc: 'prefetch:c.ts', version: 0, failed: 'no grammar' } as TokenAnswer);
    client.prefetch('c.ts', 'let b;');
    expect(fake.requests).toHaveLength(3);
    const big = 'y'.repeat(PREFETCH_TOKEN_CHARS);
    for (let index = 0; index < 90; index += 1) {
      const text = `${big}${index}`;
      client.request({ doc: `d${index}`, grammar: 'typescript', text, version: 0 }, () => {});
      fake.answer(reply(fake.requests.length, 0, [[1, 1]], true));
    }
    expect(client.select('typescript', 'const a = 1;')).toBeNull();
    expect(client.select('typescript', `${big}89`)).not.toBeNull();
  });

  it('creates a module worker for the tokenizer', () => {
    const worker = createTokenWorker() as unknown as Worker;
    expect(typeof worker.postMessage).toBe('function');
    worker.terminate();
  });
});
