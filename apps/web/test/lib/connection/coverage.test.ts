import { afterEach, beforeEach, describe, expect, it, type Mock, spyOn } from 'bun:test';
import { renderHook, waitFor } from '@testing-library/react';
import {
  refreshCoverageDetection,
  resetCoverageDetection,
  selectCoverageDetection,
  useCoverageDetection,
} from '@/lib/connection/coverage.ts';

let fetchSpy: Mock<typeof fetch>;
let answer: () => Response;

beforeEach(() => {
  resetCoverageDetection();
  answer = () =>
    Response.json({ detected: { web: { tool: 'Vitest', command: 'npx vitest run --coverage' } } });
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async () => answer()) as unknown as typeof fetch);
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe('coverage detection', () => {
  it('reads what Auto finds in every repository, and again when the repositories change', async () => {
    const { result, rerender } = renderHook(({ key }) => useCoverageDetection(key), {
      initialProps: { key: 'web' },
    });
    await waitFor(() =>
      expect(result.current).toEqual({ web: { tool: 'Vitest', command: 'npx vitest run --coverage' } })
    );
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe('/api/repos/coverage');
    rerender({ key: 'web,app' });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    rerender({ key: '' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('shares one read, and a failed or empty read finds nothing anywhere', async () => {
    answer = () => new Response('down', { status: 500 });
    await Promise.all([refreshCoverageDetection(), refreshCoverageDetection()]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(selectCoverageDetection()).toEqual({});
    answer = () => Response.json({});
    await refreshCoverageDetection();
    expect(selectCoverageDetection()).toEqual({});
  });
});
