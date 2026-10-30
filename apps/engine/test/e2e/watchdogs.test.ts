import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { join } from 'node:path';
import { handleScheduleTool } from '../../src/schedules/tools.ts';
import { SecretStore } from '../../src/secrets/store.ts';
import type { AgentContext } from './harness.ts';
import { World } from './harness.ts';

setDefaultTimeout(30_000);

let world: World | null = null;

afterEach(async () => {
  await world?.dispose();
  world = null;
});

const WATCHDOG = {
  title: 'Greeting renders',
  check: 'The greeting still renders for every visitor.',
  source: { server: 'maple', data: 'Logs of the greeting service' },
  first_check_minutes: 360,
  max_gap_hours: 6,
  for_hours: 48,
};

function writePhase(phase: number, walkthrough: Record<string, unknown> | null) {
  return async (agent: AgentContext) => {
    agent.write(phase === 1 ? 'a.txt' : 'b.txt', `phase ${phase}\n`);
    await agent.call('complete_phase', {
      summary: `Wrote the file for phase ${phase}.`,
      spots: [{ file: 'a.txt', start: 1, end: 1, attention: 'normal', why: 'The new file.' }],
      judgement_calls: [],
      ...(walkthrough ? { walkthrough } : {}),
    });
  };
}

async function merged() {
  world = await World.create({
    supervise: (current) => {
      const context = {
        secrets: new SecretStore(join(current.root, 'secrets.json')),
        baseUrl: () => 'http://localhost',
        timeZone: 'UTC',
        now: Date.now,
      };
      return {
        schedules: { handleTool: (name, input, call) => handleScheduleTool(name, input, call, context) },
      };
    },
  });
  const w = world;
  w.agents.queue(
    'build',
    writePhase(1, null),
    writePhase(2, { approach: 'Write two files.', flow: 'a → b', watchdogs: [WATCHDOG] })
  );
  const taskId = await w.createTask();
  const review = await w.untilGate(taskId, 'review');
  await w.answer(review, 'approve');
  await w.until('the pull request to open', () => w.task(taskId).pullRequest !== null);
  w.github.update(1, { checks: 'passing' });
  await w.sync(taskId);
  await w.answer(await w.untilGate(taskId, 'merge'), 'approve');
  await w.untilStage(taskId, 'merged');
  return { w, taskId };
}

async function fire(w: World, taskId: string) {
  const watchdog = w.task(taskId).watchdogs?.[0];
  await w.engine.dispatch({
    type: 'watchdog.fire',
    taskId,
    watchdogId: watchdog?.id ?? '',
    dueAt: watchdog?.nextCheckAt ?? 0,
  });
}

describe('watchdogs after a merge', () => {
  test('a check is a read-only turn of the task’s session in the repository, and a report it files becomes a forked task', async () => {
    const { w, taskId } = await merged();
    expect(w.task(taskId).watchdogs?.[0]).toMatchObject({ title: 'Greeting renders', status: 'watching' });
    const agentSession = w.agents.of('plan')[0]?.sessionId;

    await fire(w, taskId);
    await w.until('the healthy check', () => (w.task(taskId).watchdogs?.[0]?.checks.length ?? 0) === 1);
    const [check] = w.agents.of('watch');
    expect(check).toMatchObject({ readOnly: true, resume: agentSession });
    expect(check?.cwd).toBe(w.state.repos[w.task(taskId).repoId ?? '']?.path);
    expect(check?.prompt).toContain('the watchdog “Greeting renders”');
    await w.untilStage(taskId, 'merged');

    w.agents.queue('watch', async (agent) => {
      await agent.call('file_report', {
        title: 'Greeting fails in Safari',
        request: 'Fix the greeting in Safari: it throws on load.',
        report_id: 'err-42',
        link: 'https://maple.dev/errors/42',
        text: 'TypeError: greeting is undefined (Safari 18, 37 events since the merge)',
      });
      await agent.call('report_read', { summary: 'One new error since the merge; filed it.' });
    });
    await fire(w, taskId);
    await w.until('the tripped watchdog', () => w.task(taskId).watchdogs?.[0]?.status === 'tripped');
    const [forkId = ''] = w.task(taskId).watchdogs?.[0]?.forkTaskIds ?? [];
    expect(w.task(forkId)).toMatchObject({
      forkOf: taskId,
      createdBy: { kind: 'watchdog', taskId },
      sourceReport: { server: 'maple', reportId: 'err-42', scheduleId: null },
    });
    expect(w.task(forkId).request).toContain('Fix the greeting in Safari');
    expect(w.task(forkId).request).toContain('Reported in maple');
    await w.until('the fork to plan', () => w.agents.sessions.some((session) => session.fork));
    const forked = w.agents.sessions.find((session) => session.fork);
    expect(forked?.resume).toBe(agentSession);
    expect(w.task(taskId).stage).toBe('merged');
  });
});
