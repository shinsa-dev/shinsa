import { describe, expect, test } from 'bun:test';
import { BunServices } from '@effect/platform-bun';
import { serializeTaskDetail } from '@shinsa/core';
import type { ChatEvent, ShinsaState } from '@shinsa/core';
import { Effect, Layer } from 'effect';
import { resolveTaskReading } from '../../src/agents/reading/task.ts';
import { Transcripts } from '../../src/agents/transcripts/service.ts';
import { createAutopilotReplyReader } from '../../src/autopilot/judge.ts';
import { EngineConfig } from '../../src/config/service.ts';
import { Engine } from '../helpers/engine.ts';
import { openEventLog } from '../helpers/event-log.ts';
import { createTestConfig } from '../helpers/index.ts';
import { createRun } from '../helpers/state.ts';

async function startPlanning() {
  const config = createTestConfig();
  const engine = new Engine(openEventLog(config.databasePath));
  const service = Effect.runSync(
    Transcripts.use(Effect.succeed).pipe(
      Effect.provide(
        Transcripts.layer.pipe(
          Layer.provide(Layer.merge(Layer.succeed(EngineConfig, config), BunServices.layer))
        )
      )
    )
  );
  const transcripts = {
    service,
    record: (runId: string, entry: ChatEvent) => Effect.runPromise(service.record(runId, entry)),
  };
  await engine.dispatch({
    type: 'repo.register',
    repo: {
      name: 'app',
      path: '/code/app',
      defaultBranch: 'main',
      remote: null,
      checkCommands: ['true'],
    },
    projectName: null,
  });
  const repoId = Object.keys(engine.state.repos)[0] ?? '';
  await engine.dispatch({ type: 'task.create', request: 'Fix the tab scroll', repoId });
  const taskId = Object.keys(engine.state.tasks)[0] ?? '';
  await engine.dispatch({
    type: 'task.triage',
    taskId,
    title: 'Fix the tab scroll',
    repoId,
    size: 'small',
    branch: 'fix/tab-scroll',
    waitsOn: [],
  });
  await engine.dispatch({ type: 'worktree.ready', taskId, path: '/wt/fix', branch: 'fix/tab-scroll' });
  const runId = Object.keys(engine.state.runs)[0] ?? '';
  return { engine, transcripts, taskId, runId };
}

function read(state: ShinsaState, transcripts: { service: Transcripts['Service'] }, taskId: string) {
  return Effect.runSync(resolveTaskReading(state, transcripts.service, taskId));
}

describe('reading a task for an agent', () => {
  test('a task nobody has replied on reads as its description', async () => {
    const { engine, transcripts, taskId, runId } = await startPlanning();
    await transcripts.record(runId, { type: 'agent', phase: 'interim', text: 'Looking around.' });
    expect(read(engine.state, transcripts, taskId)).toBe(serializeTaskDetail(engine.state, taskId));
  });

  test('a missing task says so', async () => {
    const { engine, transcripts } = await startPlanning();
    expect(read(engine.state, transcripts, 'nope')).toBe('No task nope. `find_tasks` lists the tasks.');
  });

  test('adds the last three final replies of its own agents, cut when long, and never a delegated agent’s', async () => {
    const { engine, transcripts, taskId, runId } = await startPlanning();
    for (const text of ['First.', 'Second.', 'Third.', 'x'.repeat(1_600)]) {
      await transcripts.record(runId, { type: 'agent', phase: 'final', text });
    }
    await transcripts.record(runId, { type: 'user', from: 'you', text: 'Thanks.', attachments: [] });
    await engine.dispatch({
      type: 'agent.delegate',
      runId,
      requestKey: 'req-1',
      title: 'Check the scroll code',
      brief: 'Find where the tab scroll is handled.',
      role: 'planner',
      mode: 'async',
      isolation: 'shared',
      baseCommit: null,
      provider: null,
      model: null,
    });
    const childId = Object.keys(engine.state.runs).find((id) => id !== runId) ?? '';
    await transcripts.record(childId, { type: 'agent', phase: 'final', text: 'Delegated reply.' });
    const reading = read(engine.state, transcripts, taskId);
    expect(reading.startsWith(serializeTaskDetail(engine.state, taskId))).toBe(true);
    expect(reading.split('\n').slice(-4)).toEqual([
      'Latest agent replies:',
      '- agent: Second.',
      '- agent: Third.',
      `- agent: ${'x'.repeat(1_500)}…`,
    ]);
    expect(reading).not.toContain('Delegated reply.');
    expect(reading).not.toContain('First.');
  });

  test('replies are read in the order the runs started', async () => {
    const { engine, transcripts, taskId, runId } = await startPlanning();
    const state = structuredClone(engine.state);
    const started = state.runs[runId]?.startedAt ?? 0;
    state.runs['run-builder'] = createRun({
      id: 'run-builder',
      taskId,
      startedAt: started + 1,
    });
    state.runs['run-early'] = createRun({
      id: 'run-early',
      taskId,
      role: 'reviewer',
      startedAt: started - 1,
    });
    await transcripts.record('run-builder', { type: 'agent', phase: 'final', text: 'Built it.' });
    await transcripts.record(runId, { type: 'agent', phase: 'final', text: 'Planned it.' });
    await transcripts.record('run-early', { type: 'agent', phase: 'final', text: 'Looked first.' });
    expect(read(state, transcripts, taskId).split('\n').slice(-3)).toEqual([
      '- reviewer: Looked first.',
      '- agent: Planned it.',
      '- agent: Built it.',
    ]);
  });

  test('Autopilot reads only the task agent’s final replies, with when each came', async () => {
    const { engine, transcripts, taskId, runId } = await startPlanning();
    const state = structuredClone(engine.state);
    state.runs['run-review'] = createRun({ id: 'run-review', taskId, role: 'reviewer' });
    await transcripts.record(runId, { type: 'agent', phase: 'interim', text: 'Looking around.' });
    await transcripts.record(runId, { type: 'agent', phase: 'final', text: 'Planned it.' });
    await transcripts.record('run-review', { type: 'agent', phase: 'final', text: 'Reviewed it.' });
    const replies = Effect.runSync(createAutopilotReplyReader(transcripts.service)(state, taskId));
    expect(replies).toEqual([{ at: expect.any(Number), text: 'Planned it.' }]);
  });
});
