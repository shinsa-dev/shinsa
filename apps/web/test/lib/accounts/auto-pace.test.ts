import { describe, expect, it } from 'bun:test';
import { createSettings, type UsageWait } from '@shinsa/core';
import { listPaceBudgets, listRankedProjects, moveProject, shiftProject } from '@/lib/accounts/auto-pace.ts';
import { createProject, createShinsaState, createTask, NOW } from '../../support/state.ts';

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
    expect(listPaceBudgets(state, NOW)).toEqual([
      {
        provider: 'claude',
        label: 'Claude for the next 24 hours',
        value: '126% left',
        detail: 'Of 140% of a weekly limit, with 10% kept for urgent tasks. 1 build waiting',
      },
      {
        provider: 'codex',
        label: 'Codex for the next 24 hours',
        value: '45% left',
        detail: 'Of 50% of a weekly limit, with 10% kept for urgent tasks. 2 builds waiting',
      },
    ]);
    const idle = createShinsaState({
      patch: { usagePaces: { claude: { provider: 'claude', pace: 2, at: NOW } } },
    });
    expect(listPaceBudgets(idle, NOW)[0]?.detail).toBe(
      'Of 2% of a weekly limit, with 10% kept for urgent tasks'
    );
  });

  it('ranks projects by your order, the rest by name, and moves one by dragging or by a step', () => {
    const projects = [
      createProject({ id: 'side', name: 'Side' }),
      createProject({ id: 'web', name: 'Web' }),
      createProject({ id: 'app', name: 'App' }),
    ];
    const state = createShinsaState({
      projects,
      patch: { settings: { ...createSettings(), projectOrder: ['web'] } },
    });
    expect(listRankedProjects(state).map((project) => project.id)).toEqual(['web', 'app', 'side']);
    const order = ['web', 'app', 'side'];
    expect(moveProject(order, 'side', 'web')).toEqual(['side', 'web', 'app']);
    expect(moveProject(order, 'web', 'side')).toEqual(['app', 'side', 'web']);
    expect(moveProject(order, 'web', 'web')).toEqual(order);
    expect(moveProject(order, 'gone', 'web')).toEqual(order);
    expect(shiftProject(order, 'app', -1)).toEqual(['app', 'web', 'side']);
    expect(shiftProject(order, 'app', 1)).toEqual(['web', 'side', 'app']);
    expect(shiftProject(order, 'web', -1)).toEqual(order);
    expect(shiftProject(order, 'side', 1)).toEqual(order);
  });
});
