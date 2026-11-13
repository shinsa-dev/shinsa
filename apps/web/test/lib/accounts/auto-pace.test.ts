import { describe, expect, it } from 'bun:test';
import { DAY_MS, HOUR_MS, type UsageWait } from '@shinsa/core';
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
          codex: { provider: 'codex', pace: 50, resetPace: 50, endingPace: 50, resetEndsAt: null, at: NOW },
          claude: {
            provider: 'claude',
            pace: 140,
            resetPace: 140,
            endingPace: 140,
            resetEndsAt: null,
            at: NOW,
          },
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
    const idle = createShinsaState({
      patch: {
        usagePaces: {
          claude: { provider: 'claude', pace: 2, resetPace: 2, endingPace: 2, resetEndsAt: null, at: NOW },
        },
      },
    });
    expect(selectPaceBudget(idle, 'claude', NOW)?.detail).toBe(
      'Of 2% of a weekly limit, with 10% kept for urgent tasks'
    );
  });

  it('says builds count on you using a reset only while the resets setting is on', () => {
    const paces = (resetEndsAt: number | null, endingPace = 130) => ({
      claude: { provider: 'claude', pace: 100, resetPace: 160, endingPace, resetEndsAt, at: NOW },
    });
    const off = createShinsaState({ patch: { usagePaces: paces(null) } });
    expect(selectPaceBudget(off, 'claude', NOW)?.detail).toBe(
      'Of 100% of a weekly limit, with 10% kept for urgent tasks'
    );
    const on = createShinsaState({ patch: { usagePaces: paces(NOW + 30 * DAY_MS) } });
    on.settings = { ...on.settings, autoPaceResets: true };
    expect(selectPaceBudget(on, 'claude', NOW, 'Claude')?.detail).toBe(
      'Of 100% of a weekly limit, with 10% kept for urgent tasks. Urgent and high-priority builds may use up to 160%, counting on you using a reset in Claude'
    );
    const ending = createShinsaState({ patch: { usagePaces: paces(NOW + 2 * DAY_MS + HOUR_MS) } });
    ending.settings = { ...ending.settings, autoPaceResets: true };
    expect(selectPaceBudget(ending, 'claude', NOW)?.detail).toBe(
      'Of 100% of a weekly limit, with 10% kept for urgent tasks. A usage reset ends in 2 days, so every build may use up to 130%, counting on you using it in Claude'
    );
    const today = createShinsaState({ patch: { usagePaces: paces(NOW + 5 * HOUR_MS) } });
    today.settings = { ...today.settings, autoPaceResets: true };
    expect(selectPaceBudget(today, 'claude', NOW)?.detail).toContain('A usage reset ends in 5h');
    const worthless = createShinsaState({ patch: { usagePaces: paces(NOW + 2 * DAY_MS, 100) } });
    worthless.settings = { ...worthless.settings, autoPaceResets: true };
    expect(selectPaceBudget(worthless, 'claude', NOW)?.detail).toContain(
      'Urgent and high-priority builds may use up to 160%'
    );
    const same = createShinsaState({
      patch: {
        usagePaces: {
          claude: {
            provider: 'claude',
            pace: 100,
            resetPace: 100.2,
            endingPace: 100,
            resetEndsAt: null,
            at: NOW,
          },
        },
      },
    });
    same.settings = { ...same.settings, autoPaceResets: true };
    expect(selectPaceBudget(same, 'claude', NOW)?.detail).toBe(
      'Of 100% of a weekly limit, with 10% kept for urgent tasks'
    );
  });
});
