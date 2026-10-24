import type { Run, RunDelegation } from '@shinsa/core';
import { createSampleRun, createSampleTask, MINUTE } from './samples.ts';

function createSampleDelegation(
  now: number,
  overrides: Partial<RunDelegation> & { parentRunId: string; title: string }
): RunDelegation {
  return {
    depth: 1,
    requestKey: overrides.title,
    brief: overrides.title,
    mode: 'async',
    wake: 'always',
    isolation: 'shared',
    baseCommit: null,
    delivery: 'none',
    question: null,
    requestedAt: now - 8 * MINUTE,
    ...overrides,
  };
}

export function createSampleDelegations(now: number) {
  const taskId = 'delegating';
  const lead = createSampleRun(now, { id: 'lead', taskId, startedAt: now - 14 * MINUTE });
  const delegated = (
    id: string,
    role: Run['role'],
    delegation: Partial<RunDelegation> & { title: string },
    run: Partial<Run> = {}
  ) => {
    return createSampleRun(now, {
      id,
      taskId,
      role,
      delegation: createSampleDelegation(now, { parentRunId: 'lead', ...delegation }),
      ...run,
    });
  };
  return {
    task: createSampleTask(now, { id: taskId, title: 'Run the embedded chat on MCP v2' }),
    runs: [
      lead,
      delegated('review', 'reviewer', { title: 'Review the session cleanup' }),
      delegated(
        'tests',
        'builder',
        { title: 'Write tests for the MCP session' },
        {
          status: 'waiting',
          waitingOn: { delegations: ['fixtures'], since: now - 3 * MINUTE, reason: 'fixtures' },
        }
      ),
      delegated('fixtures', 'builder', {
        parentRunId: 'tests',
        depth: 2,
        title: 'Build the transcript fixtures',
        question: {
          id: 'fixtures-question',
          question: 'Should the fixtures cover the v1 transcript format too?',
          context: null,
          choices: [],
          recommendation: null,
          askedAt: now - 2 * MINUTE,
          delivered: true,
          answer: null,
          answeredAt: null,
        },
      }),
      delegated(
        'docs',
        'builder',
        { title: 'Document the new wake rules' },
        {
          endedAt: now - 4 * MINUTE,
          outcome: 'completed',
          summary: 'Updated `docs/engine.md` → Delegation with the wake rules and one example per mode.',
        }
      ),
      delegated(
        'lint',
        'builder',
        { title: 'Fix the lint errors in mcp-session.ts' },
        {
          endedAt: now - 5 * MINUTE,
          outcome: 'failed',
          summary: 'Biome still reports 3 errors it cannot fix on its own in `mcp-session.ts`.',
        }
      ),
      delegated(
        'spike',
        'planner',
        { title: 'Sketch a streaming fallback' },
        { endedAt: now - 6 * MINUTE, outcome: 'cancelled' }
      ),
    ],
  };
}
