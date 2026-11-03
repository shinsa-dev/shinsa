import { describe, expect, it } from 'bun:test';
import { requestCodeAnswer } from '@/lib/connection/code-reads.ts';
import { answerFetch } from '../../support/fetch-fake.ts';

describe('requestCodeAnswer', () => {
  it('reads each kind of code answer at its own path', async () => {
    const requests = answerFetch(() => Response.json({ ok: true }));
    for (const name of ['refs', 'paths', 'tree', 'blob', 'diff'])
      expect(await requestCodeAnswer('t1', name, { ref: 'working' })).toEqual({ ok: true } as never);
    expect(requests.map(({ path }) => path)).toEqual([
      '/api/tasks/t1/refs?ref=working',
      '/api/tasks/t1/paths?ref=working',
      '/api/tasks/t1/tree?ref=working',
      '/api/tasks/t1/blob?ref=working',
      '/api/tasks/t1/diff?ref=working',
    ]);
  });

  it('answers a read Shinsa has no endpoint for as the engine would, without asking', async () => {
    const requests = answerFetch(() => Response.json({ ok: true }));
    await expect(requestCodeAnswer('t1', 'nope', {})).rejects.toThrow('No such endpoint.');
    expect(requests).toEqual([]);
  });
});
