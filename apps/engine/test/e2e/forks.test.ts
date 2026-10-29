import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { ProviderRegistry } from '../../src/agents/providers/index.ts';
import { World } from './harness.ts';

setDefaultTimeout(30_000);

let world: World | null = null;

afterEach(async () => {
  await world?.dispose();
  world = null;
});

async function answeredSource() {
  world = await World.create({
    providers: (created) => new ProviderRegistry([created.agents.provider('claude', 'Claude')]),
  });
  const source = await world.createTask('Where does the greeting live?', { shape: 'answer' });
  await world.untilStage(source, 'done');
  const sessionId = world.agents.sessions.find((session) => session.role === 'answerer')?.sessionId ?? '';
  expect(sessionId).not.toBe('');
  return { w: world, source, sessionId };
}

function listTaskSessions(w: World, taskId: string) {
  const runIds = new Set(
    Object.values(w.state.runs)
      .filter((run) => run.taskId === taskId)
      .map((run) => run.id)
  );
  return w.agents.sessions.filter((session) => session.runId !== null && runIds.has(session.runId));
}

describe('forking a task', () => {
  test('the forked task’s Agent starts on a copy of the source session, and keeps its own after that', async () => {
    const { w, source, sessionId } = await answeredSource();
    const forked = await w.createTask('Show the greeting in Safari too', { forkOf: source });
    await w.untilGate(forked, 'review');
    const [first, ...later] = listTaskSessions(w, forked);
    expect(first).toMatchObject({ key: 'plan', resume: sessionId, fork: true });
    expect(first?.sessionId).not.toBe(sessionId);
    expect(first?.prompt).toContain('It was copied into this new task, so you keep all it learned.');
    expect(first?.prompt).toContain('You now work in');
    const own = first?.sessionId ?? '';
    for (const session of later.filter((candidate) => candidate.role === 'agent')) {
      expect(session).toMatchObject({ resume: own, fork: false, sessionId: own });
    }
    expect(Object.values(w.state.runs).filter((run) => run.taskId === source).length).toBe(1);
    expect(w.task(source).stage).toBe('done');
  });

  test('a source session the agent lost is restored from the source task’s transcript instead', async () => {
    const { w, source, sessionId } = await answeredSource();
    w.agents.lost.add(sessionId);
    const forked = await w.createTask('Show the greeting in Safari too', { forkOf: source });
    await w.until('the forked task planned', () => listTaskSessions(w, forked).length > 0);
    const [first] = listTaskSessions(w, forked);
    expect(first).toMatchObject({ key: 'plan', resume: null, fork: false });
    expect(first?.prompt).toContain(
      'The conversation below is the one of the task this task was forked from.'
    );
    expect(first?.prompt).toContain('Where does the greeting live?');
    const run = Object.values(w.state.runs).find((candidate) => candidate.taskId === forked);
    await w.until('the attempt is recorded', () => (w.state.runs[run?.id ?? '']?.attempts?.length ?? 0) > 0);
    expect(w.state.runs[run?.id ?? '']?.attempts?.[0]?.handoff).toMatchObject({ reason: 'fork' });
  });

  test('a restart while the fork plans resumes the fork’s own copy, never the source session', async () => {
    const { w, source, sessionId } = await answeredSource();
    w.agents.queue('plan', (agent) => agent.hang());
    const forked = await w.createTask('Show the greeting in Safari too', { forkOf: source });
    await w.until('the fork to start planning', () => listTaskSessions(w, forked).length === 1);
    const [copy] = listTaskSessions(w, forked);
    expect(copy).toMatchObject({ resume: sessionId, fork: true });
    await w.restartGracefully();
    await w.untilGate(forked, 'review');
    const [, resumed] = listTaskSessions(w, forked);
    expect(resumed).toMatchObject({ key: 'plan', resume: copy?.sessionId, fork: false });
    expect(listTaskSessions(w, forked).filter((session) => session.fork)).toHaveLength(1);
    expect(listTaskSessions(w, forked).some((session) => !session.fork && session.resume === sessionId)).toBe(
      false
    );
    expect(w.task(source).stage).toBe('done');
  });
});
