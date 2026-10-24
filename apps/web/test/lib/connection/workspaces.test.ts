import { afterEach, beforeEach, describe, expect, it, type Mock, spyOn } from 'bun:test';
import { renderHook, waitFor } from '@testing-library/react';
import {
  refreshWorkspaceSupport,
  resetWorkspaceSupport,
  selectWorkspaceSupport,
  useWorkspaceSupport,
} from '@/lib/connection/workspaces.ts';

let fetchSpy: Mock<typeof fetch>;
let answer: () => Response;

beforeEach(() => {
  resetWorkspaceSupport();
  answer = () => Response.json({ support: { web: { butInstalled: true, gitButlerWorkspace: false } } });
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async () => answer()) as unknown as typeof fetch);
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe('workspace support', () => {
  it('reads every repository’s GitButler support once at a time, and again when the repositories change', async () => {
    const { result, rerender } = renderHook(({ key }) => useWorkspaceSupport(key), {
      initialProps: { key: 'web' },
    });
    await waitFor(() =>
      expect(result.current).toEqual({ web: { butInstalled: true, gitButlerWorkspace: false } })
    );
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe('/api/repos/workspaces');
    rerender({ key: 'web,app' });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    rerender({ key: '' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('shares one read, and a failed read offers GitButler nowhere', async () => {
    answer = () => new Response('down', { status: 500 });
    await Promise.all([refreshWorkspaceSupport(), refreshWorkspaceSupport()]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(selectWorkspaceSupport()).toEqual({});
  });
});
