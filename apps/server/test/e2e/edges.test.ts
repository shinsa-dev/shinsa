import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCommandOrThrow } from '../../src/shell/index.ts';
import { PLAN, toolPlan, World } from './harness.ts';

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

async function toPullRequest(w: World, request?: string) {
  const taskId = await w.createTask(request);
  await w.untilStage(taskId, 'awaiting_review');
  await w.answer(await w.untilGate(taskId, 'review'), 'approve');
  await w.until('the pull request to open', () => w.task(taskId).pullRequest !== null);
  return taskId;
}

function remoteLog(w: World, branch: string) {
  return Bun.spawnSync(['git', 'log', '--format=%s', branch], { cwd: w.origin }).stdout.toString();
}

describe('the pull request loop', () => {
  test('unresolved review comments start a fixer and the fix is pushed', async () => {
    const w = await open();
    const taskId = await toPullRequest(w);
    w.github.update(1, { checks: 'passing', unresolved: 2 });
    w.agents.queue('fixer', async (agent) => {
      expect(agent.prompt).toContain('2 unresolved review comments');
      agent.write('comments.txt', 'addressed\n');
      await agent.call('complete_fix', { summary: 'Addressed both comments.' });
    });
    await w.sync(taskId);
    const branch = w.task(taskId).branch ?? '';
    await w.until('the fix to reach origin', () =>
      remoteLog(w, branch).includes('fix: address pull request feedback')
    );
    w.github.update(1, { unresolved: 0 });
    await w.sync(taskId);
    await w.untilGate(taskId, 'merge');
  });

  test('a merge conflict sends a fixer that is told to merge, never rebase', async () => {
    const w = await open();
    const taskId = await toPullRequest(w);
    w.github.update(1, { checks: 'passing', mergeable: 'CONFLICTING' });
    let prompt = '';
    w.agents.queue('fixer', async (agent) => {
      prompt = agent.prompt;
      await agent.call('complete_fix', { summary: 'Resolved the conflict.' });
    });
    await w.sync(taskId);
    await w.until('the fixer to run', () => w.agents.of('fixer').length === 1);
    expect(prompt).toContain('Merge the base branch into it');
    expect(prompt).toContain('never rebase');
  });

  test('a merge gate is withdrawn when CI turns red again', async () => {
    const w = await open();
    const taskId = await toPullRequest(w);
    w.github.update(1, { checks: 'passing' });
    await w.sync(taskId);
    await w.untilGate(taskId, 'merge');
    w.agents.queue('fixer', (agent) => agent.hang());
    w.github.update(1, { checks: 'failing' });
    await w.sync(taskId);
    await w.until('the merge gate to go', () => w.gates(taskId).length === 0);
    expect(w.task(taskId).stage).toBe('fixing');
  });

  test('a pull request closed on GitHub cancels the task and cleans up', async () => {
    const w = await open();
    const taskId = await toPullRequest(w);
    w.github.update(1, { state: 'CLOSED' });
    await w.sync(taskId);
    await w.untilStage(taskId, 'cancelled');
    await w.until('the worktree to be removed', () => w.task(taskId).worktreePath === null);
  });

  test('a push that keeps failing ends in a failure gate after the retries', async () => {
    const w = await open();
    const taskId = await w.createTask();
    await w.untilStage(taskId, 'awaiting_review');
    rmSync(w.origin, { recursive: true, force: true });
    await w.answer(await w.untilGate(taskId, 'review'), 'approve');
    const gate = await w.untilGate(taskId, 'failure');
    expect(gate.title).toBe('Could not open the pull request');
    const pushes = w.daemon.log.listEffectStatuses().filter((row) => row.kind === 'pull_request.open');
    expect(pushes).toEqual([
      expect.objectContaining({ kind: 'pull_request.open', status: 'failed', attempts: 5 }),
    ]);
  });
});

describe('waiting on another task', () => {
  test('a task that waits on another starts after it merges, from the updated default branch', async () => {
    const w = await open();
    const parent = await toPullRequest(w, 'Base work');
    w.dependOn = [parent];
    const child = await w.createTask('Build on it');
    await w.untilStage(child, 'waiting_on_tasks');
    expect(w.task(child).waitsOn).toEqual([parent]);
    expect(w.task(child).worktreePath).toBeNull();
    expect(w.activeRuns(child)).toHaveLength(0);

    w.agents.queue('planner', async (agent) => {
      expect(agent.prompt).toContain('which has merged');
      await agent.call(
        'propose_plan',
        toolPlan({
          ...PLAN,
          phases: [
            { title: 'Write the third file', detail: 'Create c.txt.' },
            { title: 'Write the fourth file', detail: 'Create d.txt.' },
          ],
        })
      );
    });
    w.agents.queue(
      'builder',
      async (agent) => {
        agent.write('c.txt', 'on top\n');
        await agent.call('complete_phase', { summary: 'Phase one on top.', spots: [], judgement_calls: [] });
      },
      async (agent) => {
        agent.write('d.txt', 'on top\n');
        await agent.call('complete_phase', { summary: 'Phase two on top.', spots: [], judgement_calls: [] });
      }
    );
    const parentBranch = w.task(parent).branch ?? '';
    await runCommandOrThrow(['git', 'update-ref', 'refs/heads/main', `refs/heads/${parentBranch}`], w.origin);
    w.github.update(1, { state: 'MERGED' });
    await w.sync(parent);
    await w.untilStage(parent, 'merged');
    await w.untilStage(child, 'awaiting_review');
    const worktree = w.task(child).worktreePath ?? '';
    const history = await runCommandOrThrow(['git', 'log', '--format=%s'], worktree);
    expect(history).toContain('fix: write the first file');
    const own = await runCommandOrThrow(['git', 'log', '--format=%s', 'origin/main..HEAD'], worktree);
    expect(own.split('\n')).toEqual(['fix: write the fourth file', 'fix: write the third file']);

    await w.answer(await w.untilGate(child, 'review'), 'approve');
    await w.until('the pull request to open', () => w.task(child).pullRequest !== null);
    expect(w.github.pulls[1]?.base).toBe('main');
  });

  test('cancelling the parent pauses the waiting task until you decide', async () => {
    const w = await open();
    const parent = await w.createTask('Base work');
    const child = await w.createTask('Build on it', { waitsOn: [parent] });
    await w.untilStage(child, 'waiting_on_tasks');
    await w.engine.dispatch({ type: 'task.cancel', taskId: parent });
    const gate = await w.untilGate(child, 'failure');
    expect(gate.title).toBe('“Base work” was cancelled');
    await w.answer(gate, 'approve');
    await w.untilStage(child, 'awaiting_review');
    expect(w.task(child).waitsOn).toEqual([]);
  });

  test('a task that waits on two others starts after both finish, and a cancelled one pauses it', async () => {
    const w = await open();
    const first = await w.createTask('First base');
    const second = await w.createTask('Second base');
    const gone = await w.createTask('Dropped base');
    const child = await w.createTask('Build on all of them', { waitsOn: [first, second, gone] });
    await w.untilStage(child, 'waiting_on_tasks');
    await w.engine.dispatch({ type: 'task.cancel', taskId: gone });
    const gate = await w.untilGate(child, 'failure');
    expect(gate.title).toBe('“Dropped base” was cancelled');
    await w.answer(gate, 'approve');
    await w.until('the cancelled task to be dropped', () => w.task(child).waitsOn.length === 2);
    expect(w.task(child).waitsOn).toEqual([first, second]);

    await w.engine.dispatch({ type: 'task.complete', taskId: first });
    await w.engine.settle();
    expect(w.task(child).stage).toBe('waiting_on_tasks');
    expect(w.activeRuns(child)).toHaveLength(0);
    await w.engine.dispatch({ type: 'task.complete', taskId: second });
    await w.untilStage(child, 'awaiting_review');
  });
});

describe('plan approval', () => {
  test('with plan approval on, a large task waits for the plan and a revision resumes the planner', async () => {
    const w = await open();
    await w.engine.dispatch({ type: 'settings.change', patch: { approvePlans: true } });
    w.agents.queue('planner', async (agent) => {
      await agent.call('propose_plan', toolPlan(PLAN));
    });
    const taskId = await w.createTask('Rework the whole greeting architecture');
    const plan = await w.untilGate(taskId, 'plan');
    expect(w.task(taskId).size).toBe('large');
    await w.answer(plan, 'revise', 'Only one file.');
    await w.until('the planner to resume', () => w.agents.of('planner').length === 2);
    expect(w.agents.of('planner')[1]?.resume).toBe(w.agents.of('planner')[0]?.sessionId);
    expect(w.agents.of('planner')[1]?.prompt).toContain('Only one file.');
    await w.answer(await w.untilGate(taskId, 'plan'), 'approve');
    await w.untilStage(taskId, 'awaiting_review');
  });
});

describe('evidence and transcripts', () => {
  test('evidence files are copied into Shinsa and every session is transcribed', async () => {
    const w = await open();
    w.agents.queue('builder', async (agent) => {
      const shot = join(agent.cwd, 'shot.png');
      writeFileSync(shot, 'png');
      await agent.call('attach_evidence', { kind: 'screenshot', title: 'The new file', path: shot });
      rmSync(shot);
      agent.write('a.txt', 'a\n');
      await agent.call('complete_phase', { summary: 'Done.', spots: [], judgement_calls: [] });
    });
    const taskId = await w.createTask();
    await w.untilStage(taskId, 'awaiting_review');
    const evidence = Object.values(w.state.evidence).find((item) => item.taskId === taskId);
    expect(evidence?.uri).toMatch(/^\/api\/evidence\/.+\.png$/);
    const runs = Object.values(w.state.runs).filter((run) => run.taskId === taskId);
    for (const run of runs) {
      const transcript = Bun.file(join(w.config.transcriptsDir, `${run.id}.jsonl`));
      expect(await transcript.exists()).toBe(true);
    }
  });

  test('a hand-over that breaks the protocol is rejected with the reasons and can be fixed', async () => {
    const w = await open();
    let first = '';
    w.agents.queue('planner', async (agent) => {
      first = await agent.call('propose_plan', { goal: 'x' }).catch((error: Error) => error.message);
      await agent.call('propose_plan', toolPlan(PLAN));
    });
    const taskId = await w.createTask();
    await w.untilStage(taskId, 'awaiting_review');
    expect(first).toContain('Shinsa rejected this hand-over');
    expect(first).toContain('phases: at least 2 phases.');
  });
});

describe('restarts', () => {
  test('checks that were running when Shinsa stopped run again after the restart', async () => {
    const w = await open({ checks: ['sleep 0.4', 'test -f a.txt'] });
    const taskId = await w.createTask();
    await w.untilStage(taskId, 'checking');
    await w.restart();
    await w.untilStage(taskId, 'awaiting_review');
  });

  test('an answer to a question whose agent died with the restart starts the step again with it', async () => {
    const w = await open();
    w.agents.queue('planner', async (agent) => {
      await agent.call('ask', { question: 'Which greeting?' });
    });
    const taskId = await w.createTask();
    const gate = await w.untilGate(taskId, 'question');
    await w.restart();
    await w.engine.settle();
    expect(w.agents.of('planner')).toHaveLength(1);
    expect(w.gates(taskId)).toHaveLength(1);
    await w.answer(gate, 'reply', 'Hello.');
    await w.untilStage(taskId, 'awaiting_review');
    const resumed = w.agents.of('planner')[1];
    expect(resumed?.resume).toBe(w.agents.of('planner')[0]?.sessionId);
    expect(resumed?.prompt).toContain('Their answer: Hello.');
  });
});

describe('review fixes', () => {
  test('a repository without CI reaches the merge gate', async () => {
    const w = await open();
    const taskId = await toPullRequest(w);
    w.github.update(1, { checks: 'none' });
    await w.sync(taskId);
    await w.untilGate(taskId, 'merge');
  });

  test('CI from before the fix was pushed does not count as a failed fix', async () => {
    const w = await open();
    const taskId = await toPullRequest(w);
    w.github.update(1, { checks: 'failing' });
    w.agents.queue('fixer', async (agent) => {
      agent.write('ci.txt', 'fixed\n');
      await agent.call('complete_fix', { summary: 'Fixed CI.' });
    });
    await w.sync(taskId);
    const remoteHead = () =>
      Bun.spawnSync(['git', 'rev-parse', w.task(taskId).branch ?? ''], { cwd: w.origin })
        .stdout.toString()
        .trim();
    const firstPush = w.task(taskId).pushedSha;
    await w.until(
      'the fix to be pushed',
      () =>
        w.task(taskId).pushedSha !== firstPush &&
        w.task(taskId).pushedSha === remoteHead() &&
        w.activeRuns(taskId).length === 0 &&
        w.task(taskId).fixRounds === 1
    );
    w.github.update(1, { checks: 'passing' });
    await w.sync(taskId);
    await w.untilGate(taskId, 'merge');
  });

  test('the next agent waits for the previous one to finish in the worktree', async () => {
    const w = await open();
    const order: string[] = [];
    let taskId = '';
    const isSecondWaiting = () => {
      const second = Object.values(w.state.runs).find(
        (run) => run.taskId === taskId && run.role === 'builder' && run.phaseIndex === 1
      );
      const key = `run.execute:${second?.id}`;
      return w.daemon.log.listEffectStatuses().some((row) => row.key === key && row.status === 'running');
    };
    w.agents.queue(
      'builder',
      async (agent) => {
        agent.write('a.txt', 'a\n');
        await agent.call('complete_phase', { summary: 'One.', spots: [], judgement_calls: [] });
        await w.until('the next builder to be waiting', isSecondWaiting);
        agent.write('late.txt', 'late\n');
        order.push('first finished');
      },
      async (agent) => {
        order.push('second started');
        agent.write('b.txt', 'b\n');
        await agent.call('complete_phase', { summary: 'Two.', spots: [], judgement_calls: [] });
      }
    );
    taskId = await w.createTask();
    await w.untilStage(taskId, 'awaiting_review');
    expect(order).toEqual(['first finished', 'second started']);
  });

  test('files a reviewer changes are set aside, not committed', async () => {
    const w = await open();
    w.agents.queue('reviewer', async (agent) => {
      agent.write('a.txt', 'reviewer was here\n');
      await agent.call('report_review', { findings: [] });
    });
    const taskId = await w.createTask();
    await w.untilStage(taskId, 'awaiting_review');
    const path = w.task(taskId).worktreePath ?? '';
    await w.until(
      'the edit to be set aside',
      () => Bun.spawnSync(['git', 'status', '--porcelain'], { cwd: path }).stdout.toString() === ''
    );
    const stash = Bun.spawnSync(['git', 'stash', 'list'], { cwd: path }).stdout.toString();
    expect(stash).toContain('shinsa: edits by the reviewer');
  });
});
