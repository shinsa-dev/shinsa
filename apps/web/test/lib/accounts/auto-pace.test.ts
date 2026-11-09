import { describe, expect, it } from 'bun:test';
import type { UsageWait } from '@shinsa/core';
import { selectPaceBudget } from '@/lib/accounts/auto-pace.ts';
import { createShinsaState, createTask, NOW } from '../../support/state.ts';

function admission(provider?: string): UsageWait {
  return {
    id: 'w',
    runId: 'r',
    role: 'agent',
    phaseIndex: 0,
    account: null,
    resetAt: NOW + 60_000,
    armedAt: NOW,
    autoResume: true,
    status: 'armed',
    cause: 'pace',
    pace: { scope: 'admission', limit: 9, percent: 8, projectId: null, stageReason: 'building', need: 6 },
    ...(provider ? { provider } : {}),
  };
}

describe('Auto pace in Settings', () => {
  it('shows each provider’s budget left, the reserve and the builds waiting', () => {
    const state = createShinsaState({
      tasks: [
        createTask({ id: 'a', usageWait: admission() }),
        createTask({ id: 'b', usageWait: admission('codex') }),
        createTask({ id: 'c', usageWait: admission('codex') }),
      ],
      patch: {
        usagePaces: {
          codex: { provider: 'codex', pace: 50, at: NOW },
          claude: { provider: 'claude', pace: 140, at: NOW },
        },
      },
    });
    expect(selectPaceBudget(state, 'claude', NOW)).toEqual({
      provider: 'claude',
      label: 'Left for builds in the next 24 hours',
      value: '126% left',
      detail: 'Of 140% of a weekly limit, with 10% kept for urgent tasks. 1 build waiting',
    });
    expect(selectPaceBudget(state, 'codex', NOW)).toEqual({
      provider: 'codex',
      label: 'Left for builds in the next 24 hours',
      value: '45% left',
      detail: 'Of 50% of a weekly limit, with 10% kept for urgent tasks. 2 builds waiting',
    });
    expect(selectPaceBudget(state, 'gemini', NOW)).toBeNull();
    expect(selectPaceBudget(state, 'claude', NOW, 139.8)?.detail).toBe(
      'Of 140% of a weekly limit, with 10% kept for urgent tasks. 1 build waiting'
    );
    expect(selectPaceBudget(state, 'claude', NOW, 100)?.detail).toBe(
      'Of 140% of a weekly limit, counting your usable usage resets, with 10% kept for urgent tasks. 1 build waiting'
    );
    const idle = createShinsaState({
      patch: { usagePaces: { claude: { provider: 'claude', pace: 2, at: NOW } } },
    });
    expect(selectPaceBudget(idle, 'claude', NOW)?.detail).toBe(
      'Of 2% of a weekly limit, with 10% kept for urgent tasks'
    );
  });
});
