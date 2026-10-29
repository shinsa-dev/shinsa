import { describe, expect, it } from 'bun:test';
import type { Evidence } from '@shinsa/core';
import { renderHook } from '@testing-library/react';
import type * as React from 'react';
import { useCallImages } from '@/hooks/use-call-images.ts';
import { RunEvidence } from '@/lib/chat/run-evidence.ts';
import { createToolCall, shinsaTool } from '../support/chat.ts';
import { createEvidence } from '../support/state.ts';

function withEvidence(evidence: Evidence[]) {
  return ({ children }: { children: React.ReactNode }) => (
    <RunEvidence.Provider value={evidence}>{children}</RunEvidence.Provider>
  );
}

describe('useCallImages', () => {
  const call = createToolCall(shinsaTool('attach_evidence', { title: 'Login page' }), { images: ['/r.png'] });

  it('adds the run evidence image for an evidence step', () => {
    const evidence = [createEvidence({ id: 'shot', taskId: 't', title: 'Login page', width: 1280 })];
    const { result } = renderHook(() => useCallImages(call), { wrapper: withEvidence(evidence) });
    expect(result.current).toEqual([
      { src: '/api/evidence/shot.png', caption: 'Login page', width: 1280 },
      '/r.png',
    ]);
  });

  it('shows only the step images outside a run', () => {
    const { result } = renderHook(() => useCallImages(call));
    expect(result.current).toEqual(['/r.png']);
  });

  it('keeps the same list across renders while nothing changes', () => {
    const { result, rerender } = renderHook(() => useCallImages(call), { wrapper: withEvidence([]) });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
