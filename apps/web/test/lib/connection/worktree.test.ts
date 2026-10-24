import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { openWorktree } from '@/lib/connection/worktree.ts';
import { spyOnToasts } from '../../support/commands.ts';

const realFetch = globalThis.fetch;

let toasts: ReturnType<typeof spyOnToasts>;

beforeEach(() => {
  toasts = spyOnToasts();
});

afterEach(() => {
  toasts.restore();
  globalThis.fetch = realFetch;
});

function serve(response: () => Response) {
  const fetch = mock(async (_url: string, _init?: RequestInit) => response());
  globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
  return fetch;
}

describe('openWorktree', () => {
  it('asks Shinsa to open the worktree at a file and line', async () => {
    const fetch = serve(() => Response.json({ ok: true }));
    expect(await openWorktree('t1', 'editor', 'src/a.ts', 12)).toBe(true);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('/api/tasks/t1/open');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ target: 'editor', path: 'src/a.ts', line: 12 });
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it('says it could not open the worktree when the app did not start', async () => {
    serve(() => Response.json({ ok: false }));
    expect(await openWorktree('t1', 'terminal')).toBe(false);
    expect(toasts.error).toHaveBeenCalledWith('Couldn’t open the worktree in a terminal');
  });

  it('shows Shinsa’s reason when it refuses', async () => {
    serve(() => Response.json({ error: { message: 'No worktree.' } }, { status: 404 }));
    expect(await openWorktree('t1', 'finder')).toBe(false);
    expect(toasts.error).toHaveBeenCalledWith('No worktree.');
  });

  it('says it could not reach Shinsa when the request fails', async () => {
    globalThis.fetch = mock(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    expect(await openWorktree('t1', 'editor')).toBe(false);
    expect(toasts.error).toHaveBeenCalledWith('Couldn’t reach Shinsa.');
    expect(toasts.error).toHaveBeenCalledTimes(1);
  });
});
