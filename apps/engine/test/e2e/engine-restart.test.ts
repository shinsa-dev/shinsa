import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import type { Run } from '@shinsa/core';
import { EngineRestarter } from '../../src/instance/index.ts';
import { PLAN, toolPlan, World } from './harness.ts';

setDefaultTimeout(30_000);

let world: World | null = null;

afterEach(async () => {
  await world?.dispose();
  world = null;
});

function listRuns(w: World, taskId: string): Run[] {
  return Object.values(w.state.runs)
    .filter((run) => run.taskId === taskId)
    .sort((a, b) => a.startedAt - b.startedAt);
}

function createRestarter(w: World, drainMs?: number) {
  const restarted = Promise.withResolvers<void>();
  const restarter = new EngineRestarter(w.engine, {
    isService: () => Promise.resolve(true),
    drain: w.daemon.runs,
    drainMs,
    restart: async () => {
      await w.restartGracefully();
      restarted.resolve();
    },
    schedule: (run) => setTimeout(run, 0),
  });
  return { restarter, restarted: restarted.promise };
}

describe('restarting the engine for an update', () => {
  test('waits for the working agent to hand over, holds the new step, and starts it on the next engine', async () => {
    world = await World.create();
    const w = world;
    const handOver = Promise.withResolvers<void>();
    w.agents.queue('plan', async (agent) => {
      await handOver.promise;
      await agent.call('propose_plan', toolPlan(PLAN));
    });
    const working = await w.createTask('Add the greeting files');
    await w.until('the first agent to start', () => w.agents.of('plan').length === 1);
    const workingSession = w.agents.of('plan')[0];
    const { restarter, restarted } = createRestarter(w);

    expect(await restarter.request('idle')).toEqual({ restarting: false });
    const held = await w.createTask('Add the farewell files');
    await w.until('the new step to be held', () =>
      listRuns(w, held).some((run) => w.daemon.runs.isHeld(run.id))
    );
    expect(w.agents.of('plan')).toHaveLength(1);
    const heldRunId = listRuns(w, held)[0]?.id ?? '';

    handOver.resolve();
    await restarted;
    await w.until('the held step to start on the new engine', () => w.agents.of('plan').length === 2);

    expect(workingSession?.cancelled).toBe(false);
    expect(listRuns(w, working)[0]).toMatchObject({ outcome: 'completed' });
    expect(listRuns(w, working)[0]?.continuations ?? []).toHaveLength(0);
    const started = w.agents.of('plan')[1];
    expect(started?.resume).toBeNull();
    expect(started?.prompt).not.toContain('Shinsa restarted while you were working');
    await w.until('the held step to finish', () => w.state.runs[heldRunId]?.outcome === 'completed');
    expect(w.state.runs[heldRunId]?.continuations).toHaveLength(1);
    expect(w.task(held).recoveries).toBe(0);
    expect(Object.values(w.state.runs).filter((run) => run.outcome === 'failed')).toEqual([]);
  });

  test('restarts at the deadline with an agent still working, and the agent resumes its own session', async () => {
    world = await World.create();
    const w = world;
    w.agents.queue('plan', (agent) => agent.hang());
    const taskId = await w.createTask();
    await w.until('the agent to start', () => w.agents.of('plan').length === 1);
    const cut = w.agents.of('plan')[0];
    const runId = listRuns(w, taskId)[0]?.id ?? '';
    const { restarter, restarted } = createRestarter(w, 20);

    expect(await restarter.request('idle')).toEqual({ restarting: false });
    await restarted;
    await w.until('the run to finish on the new engine', () => w.state.runs[runId]?.outcome === 'completed');

    expect(cut?.cancelled).toBe(true);
    const resumed = w.agents.of('plan')[1];
    expect(resumed?.resume).toBe(cut?.sessionId);
    expect(resumed?.prompt).toContain('Shinsa restarted while you were working');
    expect(w.state.runs[runId]?.continuations).toHaveLength(1);
    expect(w.task(taskId).recoveries).toBe(0);
    expect(Object.values(w.state.runs).filter((run) => run.outcome === 'failed')).toEqual([]);
  });
});
