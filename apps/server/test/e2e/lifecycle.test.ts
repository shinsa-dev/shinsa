import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type AgentScript, PLAN, toolPlan, World } from './harness.ts';

setDefaultTimeout(30_000);

let world: World | null = null;

afterEach(async () => {
  await world?.dispose();
  world = null;
});

async function open(options?: Parameters<typeof World.create>[0]) {
  world = await World.create(options);
  return world;
}

async function toReviewGate(w: World, request?: string) {
  const taskId = await w.createTask(request);
  await w.untilStage(taskId, 'awaiting_review');
  return taskId;
}

async function toPullRequest(w: World, taskId: string) {
  await w.answer(w.gates(taskId)[0] ?? (await w.untilGate(taskId, 'review')), 'approve');
  await w.until('the pull request to open', () => w.task(taskId).pullRequest !== null);
}

describe('a task from request to merge', () => {
  test('one agent plans and builds every phase in one session, then a reviewer on its own, and it stops at your review', async () => {
    const w = await open();
    const taskId = await toReviewGate(w);
    const task = w.task(taskId);

    expect(w.agents.sessions.map((session) => session.key)).toEqual(['plan', 'build', 'build', 'reviewer']);
    const [planning] = w.agents.of('plan');
    const [first, second] = w.agents.of('build');
    expect([planning?.readOnly, first?.readOnly, second?.readOnly]).toEqual([true, false, false]);
    expect(first?.resume).toBe(planning?.sessionId);
    expect(second?.resume).toBe(planning?.sessionId);
    expect(second?.prompt).toStartWith(
      'Phase 1 is committed.\nNow build phase 2 of 2: Write the second file.'
    );
    expect(w.agents.of('reviewer')[0]?.resume).toBeNull();
    expect(w.agents.of('reviewer')[0]?.prompt).toContain('You did not write this code.');
    const runs = Object.values(w.state.runs).filter((run) => run.taskId === taskId);
    expect(runs.map((run) => [run.role, run.purpose ?? null, run.phaseIndex])).toEqual([
      ['agent', 'plan', null],
      ['agent', 'build', 0],
      ['agent', 'build', 1],
      ['reviewer', null, null],
    ]);
    expect(new Set(runs.filter((run) => run.role === 'agent').map((run) => run.sessionId))).toEqual(
      new Set([planning?.sessionId ?? null])
    );

    expect(task.checkResults?.map((check) => check.outcome)).toEqual(['pass', 'pass']);
    expect(task.report?.sections.map((phase) => phase.summary)).toEqual([
      'Wrote the file for phase 1.',
      'Wrote the file for phase 2.',
    ]);
    expect(await w.branchLog(task.branch ?? '')).toEqual([
      'fix: write the second file',
      'fix: write the first file',
    ]);
    expect(w.gates(taskId).map((gate) => gate.type)).toEqual(['review']);
    expect(w.activeRuns()).toHaveLength(0);
  });

  test('approval pushes and opens the pull request; a clean PR opens the merge gate; merging settles it', async () => {
    const w = await open();
    const taskId = await toReviewGate(w);
    await toPullRequest(w, taskId);
    const branch = w.task(taskId).branch ?? '';
    expect(await w.remoteBranches()).toContain(branch);
    expect(w.github.pulls[0]).toMatchObject({ head: branch, base: 'main', state: 'OPEN' });
    expect(w.task(taskId).stageReason).toBe('waiting for CI');

    w.github.update(1, { checks: 'passing' });
    await w.sync(taskId);
    const merge = await w.untilGate(taskId, 'merge');
    await w.answer(merge, 'approve');
    await w.untilStage(taskId, 'merged');
    expect(w.github.pulls[0]).toMatchObject({ state: 'MERGED', mergedWith: '--squash' });
    await w.until('the worktree to be removed', () => w.task(taskId).worktreePath === null);
  });
});

describe('fix loops', () => {
  test('a failing check goes back to the round agent on its one session, then checks and review run again', async () => {
    const w = await open({ checks: ['test -f a.txt', 'test -f fixed.txt'] });
    w.agents.queue('fix', async (agent) => {
      expect(agent.prompt).toContain('`test -f fixed.txt` failed');
      agent.write('fixed.txt', 'ok\n');
      await agent.call('complete_fix', { summary: 'Added the missing file.' });
    });
    const taskId = await toReviewGate(w);
    const fixer = w.agents.of('fix')[0];
    const session = w.agents.of('plan')[0]?.sessionId ?? null;
    expect(w.agents.of('build').map((build) => build.resume)).toEqual([session, session]);
    expect(fixer?.resume).toBe(session);
    expect(fixer?.prompt).toStartWith('The checks failed');
    expect(w.task(taskId).fixRounds).toBe(1);
    expect(w.task(taskId).fixFor).toBe('checks');
    expect(await w.branchLog(w.task(taskId).branch ?? '')).toContain('fix: make the checks pass');
    expect(w.agents.of('reviewer')).toHaveLength(1);
  });

  test('blocking review findings are fixed and reviewed again by the reviewer’s own session', async () => {
    const w = await open();
    w.agents.queue('reviewer', async (agent) => {
      await agent.call('report_review', {
        findings: [{ severity: 'blocking', file: 'a.txt', line: 1, message: 'Say hello, not phase 1.' }],
      });
    });
    w.agents.queue('fix', async (agent) => {
      expect(agent.prompt).toContain('a.txt:1: Say hello, not phase 1.');
      agent.write('a.txt', 'hello\n');
      await agent.call('complete_fix', { summary: 'Changed the greeting.' });
    });
    const taskId = await toReviewGate(w);
    const reviewers = w.agents.of('reviewer');
    expect(reviewers).toHaveLength(2);
    expect(reviewers[0]?.resume).toBeNull();
    expect(reviewers[1]?.resume).not.toBeNull();
    expect(reviewers[1]?.resume).not.toBe(w.agents.of('fix')[0]?.resume);
    expect(reviewers[1]?.prompt).toContain('You reviewed earlier work on this task in this conversation.');
    expect(readFileSync(join(w.task(taskId).worktreePath ?? '', 'a.txt'), 'utf8')).toBe('hello\n');
  });

  test('the same failure twice stops the loop with a failure gate', async () => {
    const w = await open({ checks: ['test -f never.txt'] });
    const taskId = await w.createTask();
    const gate = await w.untilGate(taskId, 'failure');
    expect(gate.title).toBe('Fixing is not making progress');
    expect(w.agents.of('fix')).toHaveLength(2);
    expect(w.activeRuns(taskId)).toHaveLength(0);
  });

  test('failing CI on the pull request is fixed, pushed and then merged', async () => {
    const w = await open();
    const taskId = await toReviewGate(w);
    await toPullRequest(w, taskId);
    w.github.update(1, { checks: 'failing' });
    w.agents.queue('fix', async (agent) => {
      expect(agent.prompt).toContain('CI checks are failing');
      agent.write('ci.txt', 'fixed\n');
      await agent.call('complete_fix', { summary: 'Fixed CI.' });
    });
    await w.sync(taskId);
    const branch = w.task(taskId).branch ?? '';
    let remoteLog = '';
    await w.until('the CI fix to reach origin', () => {
      remoteLog = Bun.spawnSync(['git', 'log', '--format=%s', branch], { cwd: w.origin }).stdout.toString();
      return remoteLog.includes('fix: address pull request feedback');
    });
    expect(w.task(taskId).stage).toBe('shipping');
    w.github.update(1, { checks: 'passing' });
    await w.sync(taskId);
    await w.untilGate(taskId, 'merge');
  });

  test('a message at the review gate becomes a fix, then checks and review again', async () => {
    const w = await open();
    const taskId = await toReviewGate(w);
    w.agents.queue('fix', async (agent) => {
      expect(agent.prompt).toContain('Make the greeting louder.');
      agent.write('a.txt', 'HELLO\n');
      await agent.call('complete_fix', { summary: 'Louder.' });
    });
    await w.engine.dispatch({ type: 'task.message', taskId, text: 'Make the greeting louder.' });
    expect(w.gates(taskId)).toHaveLength(0);
    await w.untilStage(taskId, 'awaiting_review');
    expect(w.agents.of('reviewer')).toHaveLength(2);
  });
});

describe('talking to agents', () => {
  test('an agent question waits for your answer and the tool call returns it', async () => {
    const w = await open();
    let answer = '';
    w.agents.queue('plan', async (agent) => {
      answer = await agent.call('ask', { question: 'Lowercase or uppercase?' });
      await agent.call('propose_plan', toolPlan(PLAN));
    });
    const taskId = await w.createTask();
    const gate = await w.untilGate(taskId, 'question');
    expect(gate.title).toBe('Lowercase or uppercase?');
    await w.answer(gate, 'reply', 'Lowercase.');
    await w.untilStage(taskId, 'awaiting_review');
    expect(answer).toBe('The human answered: Lowercase.');
  });

  test('a message while an agent works reaches that session', async () => {
    const w = await open();
    let steered = '';
    w.agents.queue('plan', async (agent) => {
      steered = await agent.waitForSteer();
      await agent.call('propose_plan', toolPlan(PLAN));
    });
    const taskId = await w.createTask();
    await w.until('the planner to start', () => w.agents.of('plan').length === 1);
    await w.engine.dispatch({ type: 'task.message', taskId, text: 'Keep it tiny.' });
    await w.untilStage(taskId, 'awaiting_review');
    expect(steered).toBe('Keep it tiny.');
  });
});

describe('recovery', () => {
  test('an agent that stops without handing over is resumed once on its own session', async () => {
    const w = await open();
    w.agents.queue('build', async () => undefined);
    const taskId = await toReviewGate(w);
    const builders = w.agents.of('build');
    expect(builders).toHaveLength(3);
    expect(builders[1]?.resume).toBe(builders[0]?.sessionId);
    expect(builders[1]?.prompt).toContain('ended its turn without calling the hand-over tool');
    expect(w.task(taskId).recoveries).toBe(0);
  });

  test('a second stop opens a failure gate, and a message retries with guidance', async () => {
    const w = await open();
    w.agents.queue(
      'build',
      async () => {
        throw new Error('overloaded');
      },
      async () => {
        throw new Error('overloaded');
      }
    );
    const taskId = await w.createTask();
    const gate = await w.untilGate(taskId, 'failure');
    expect(gate.title).toBe('The agent paused');
    expect(gate.body).toBe('overloaded');
    await w.engine.dispatch({ type: 'task.message', taskId, text: 'Try again, it was a blip.' });
    await w.untilStage(taskId, 'awaiting_review');
    expect(w.agents.of('build').at(-2)?.prompt).toContain(
      'Guidance from the human: Try again, it was a blip.'
    );
  });

  test('a restart resumes the running agent with continue-where-you-left-off', async () => {
    const w = await open();
    w.agents.queue('build', (agent) => agent.hang());
    const taskId = await w.createTask();
    await w.until('the first builder to start', () => w.agents.of('build').length === 1);
    const hung = w.agents.of('build')[0];
    await w.restart();
    await w.untilStage(taskId, 'awaiting_review');
    const resumed = w.agents.of('build')[1];
    expect(resumed?.resume).toBe(hung?.sessionId);
    expect(resumed?.prompt).toContain('Shinsa restarted while you were working');
  });

  test('cancelling stops the agent and removes the worktree; a late hand-over changes nothing', async () => {
    const w = await open();
    let late: string | null = null;
    w.agents.queue('plan', async (agent) => {
      if (!agent.signal.aborted) {
        await new Promise((resolve) => agent.signal.addEventListener('abort', resolve, { once: true }));
      }
      late = await agent.call('propose_plan', toolPlan(PLAN)).catch((error: Error) => error.message);
    });
    const taskId = await w.createTask();
    await w.until('the planner to start', () => w.agents.of('plan').length === 1);
    const worktree = w.task(taskId).worktreePath ?? '';
    await w.engine.dispatch({ type: 'task.cancel', taskId });
    await w.until('the worktree to be removed', () => w.task(taskId).worktreePath === null);
    await w.until('the late hand-over', () => late !== null);
    await w.engine.settle();
    expect(w.task(taskId).stage).toBe('cancelled');
    expect(w.agents.of('plan')[0]?.cancelled).toBe(true);
    expect(existsSync(worktree)).toBe(false);
    expect(late).not.toBe(
      'Handed over: the human reads it in the chat as your reply. Stop here and write nothing more: never point at it, repeat or summarise it, and never say your turn is over.'
    );
  });
});

describe('scheduling and stacking', () => {
  test('every task gets its own agent at once: a busy agent never holds another task back', async () => {
    const w = await open();
    await w.engine.dispatch({ type: 'settings.change', patch: { maxConcurrentRuns: 1 } as never });
    const releases: (() => void)[] = [];
    const planner: AgentScript = async (agent) => {
      await new Promise<void>((resolve) => {
        releases.push(resolve);
      });
      await agent.call('propose_plan', toolPlan(PLAN));
    };
    w.agents.queue('plan', planner, planner, planner);
    const tasks = [await w.createTask('First'), await w.createTask('Second'), await w.createTask('Third')];
    await w.until('three planners at once', () => w.agents.of('plan').length === 3);
    for (const taskId of tasks) expect(w.activeRuns(taskId)[0]?.status).toBe('running');
    for (const release of releases) release();
    for (const taskId of tasks) await w.untilStage(taskId, 'awaiting_review');
  });
});
