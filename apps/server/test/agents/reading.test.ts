import { describe, expect, test } from 'bun:test';
import { serializeTaskDetail } from '@shinsa/core';
import { resolveTaskReading } from '../../src/agents/reading.ts';
import { Transcripts } from '../../src/agents/transcripts/index.ts';
import { Engine } from '../../src/runtime/index.ts';
import { EventLog } from '../../src/store/index.ts';
import { createTestConfig } from '../helpers/index.ts';
import { createRun } from '../helpers/state.ts';

async function startPlanning() {
  const config = createTestConfig();
  const engine = new Engine(new EventLog(config.databasePath));
  const transcripts = new Transcripts(config.transcriptsDir);
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

describe('reading a task for an agent', () => {
  test('a task nobody has replied on reads as its description', async () => {
    const { engine, transcripts, taskId, runId } = await startPlanning();
    transcripts.record(runId, { type: 'agent', phase: 'interim', text: 'Looking around.' });
    expect(resolveTaskReading(engine.state, transcripts, taskId)).toBe(
      serializeTaskDetail(engine.state, taskId)
    );
  });

  test('a missing task says so', async () => {
    const { engine, transcripts } = await startPlanning();
    expect(resolveTaskReading(engine.state, transcripts, 'nope')).toBe(
      'No task nope. `find_tasks` lists the tasks.'
    );
  });

  test('adds the last three final replies of its own agents, cut when long, and never a delegated agent’s', async () => {
    const { engine, transcripts, taskId, runId } = await startPlanning();
    for (const text of ['First.', 'Second.', 'Third.', 'x'.repeat(1_600)]) {
      transcripts.record(runId, { type: 'agent', phase: 'final', text });
    }
    transcripts.record(runId, { type: 'user', from: 'you', text: 'Thanks.', attachments: [] });
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
    transcripts.record(childId, { type: 'agent', phase: 'final', text: 'Delegated reply.' });
    const reading = resolveTaskReading(engine.state, transcripts, taskId);
    expect(reading.startsWith(serializeTaskDetail(engine.state, taskId))).toBe(true);
    expect(reading.split('\n').slice(-4)).toEqual([
      'Latest agent replies:',
      '- planner: Second.',
      '- planner: Third.',
      `- planner: ${'x'.repeat(1_500)}…`,
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
      role: 'builder',
      startedAt: started + 1,
    });
    state.runs['run-early'] = createRun({
      id: 'run-early',
      taskId,
      role: 'reviewer',
      startedAt: started - 1,
    });
    transcripts.record('run-builder', { type: 'agent', phase: 'final', text: 'Built it.' });
    transcripts.record(runId, { type: 'agent', phase: 'final', text: 'Planned it.' });
    transcripts.record('run-early', { type: 'agent', phase: 'final', text: 'Looked first.' });
    expect(resolveTaskReading(state, transcripts, taskId).split('\n').slice(-3)).toEqual([
      '- reviewer: Looked first.',
      '- planner: Planned it.',
      '- builder: Built it.',
    ]);
  });
});
