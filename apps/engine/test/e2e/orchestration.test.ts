import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { isDelegatedRun, listChildRuns, listOpenGates, type Run } from '@shinsa/core';
import { Transcripts } from '../../src/agents/index.ts';
import { createGitRepo } from '../helpers/index.ts';
import { type AgentContext, PLAN, toolPlan, World } from './harness.ts';

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

function phaseReport(summary: string) {
  return {
    summary,
    spots: [{ file: 'a.txt', start: 1, end: 1, attention: 'normal', why: 'The new file.' }],
    judgement_calls: [],
  };
}

function delegated(w: World, taskId: string): Run[] {
  return Object.values(w.state.runs)
    .filter((run) => run.taskId === taskId && isDelegatedRun(run))
    .sort((a, b) => a.startedAt - b.startedAt);
}

function stepRun(w: World, taskId: string, purpose: Run['purpose']) {
  return Object.values(w.state.runs).find(
    (run) => run.taskId === taskId && run.purpose === purpose && !run.delegation
  );
}

function notices(w: World, runId: string) {
  return new Transcripts(w.config.transcriptsDir)
    .listEntries(runId)
    .flatMap((entry) =>
      entry.type === 'notice' && entry.notice.kind === 'delegation' ? [entry.notice] : []
    );
}

async function nextSteer(agent: AgentContext, index = 0) {
  return agent.steers[index] ?? (await agent.waitForSteer());
}

function parse(text: string) {
  return JSON.parse(text) as Record<string, unknown>;
}

describe('delegating work to other agents', () => {
  test('an async delegation runs alongside, and its result is steered into the parent’s turn', async () => {
    const w = await open();
    let delegatedId = '';
    let steered = '';
    w.agents.queue('build', async (agent) => {
      const status = parse(
        await agent.call('delegate_task', {
          brief: 'Read a.txt and list every greeting in it.',
          role: 'reviewer',
          client_request_id: 'greetings',
        })
      );
      delegatedId = String(status.delegation_id);
      expect(status).toMatchObject({ role: 'reviewer', depth: 1, isolation: 'shared', result: null });
      steered = await nextSteer(agent);
      agent.write('a.txt', 'hello\n');
      await agent.call('complete_phase', phaseReport('Wrote the greeting.'));
    });
    w.agents.queue('reviewer', async (agent) => {
      expect(agent.prompt).toContain('Read a.txt and list every greeting in it.');
      expect(agent.prompt).toContain('The work is part of the task "Add the greeting files"');
      expect(agent.prompt).not.toContain(PLAN.goal);
      agent.say('There is one greeting: hello.');
    });
    const taskId = await w.createTask();
    await w.until('the parent to receive the result', () => steered.length > 0);
    expect(steered).toContain('There is one greeting: hello.');
    const child = w.state.runs[delegatedId];
    expect(child).toMatchObject({
      role: 'reviewer',
      outcome: 'completed',
      summary: 'There is one greeting: hello.',
    });
    expect(child?.delegation).toMatchObject({
      parentRunId: stepRun(w, taskId, 'build')?.id,
      delivery: 'delivered',
    });
    await w.untilStage(taskId, 'awaiting_review');
    const builder = stepRun(w, taskId, 'build');
    expect(notices(w, builder?.id ?? '')).toEqual([
      { kind: 'delegation', event: 'started', runIds: [delegatedId] },
      { kind: 'delegation', event: 'reported', runIds: [delegatedId] },
    ]);
    expect(
      w.agents.of('reviewer').filter((session) => session.prompt.includes('greeting in it'))
    ).toHaveLength(1);
  });

  test('the same client request id returns the task already delegated instead of starting another', async () => {
    const w = await open();
    const ids: string[] = [];
    w.agents.queue('build', async (agent) => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const status = parse(
          await agent.call('delegate_task', {
            brief: 'Check it.',
            role: 'planner',
            client_request_id: 'once',
          })
        );
        ids.push(String(status.delegation_id));
      }
      await nextSteer(agent);
      agent.write('a.txt', 'one\n');
      await agent.call('complete_phase', phaseReport('Done.'));
    });
    w.agents.queue('planner', async (agent) => {
      agent.say('Checked.');
    });
    const taskId = await w.createTask();
    await w.untilStage(taskId, 'awaiting_review');
    expect(ids[0]).toBe(ids[1] ?? '');
    expect(delegated(w, taskId)).toHaveLength(1);
  });

  test('a wait that times out tells the parent, which ends its turn and is woken by the result', async () => {
    const w = await open({ supervise: () => ({ minuteMs: 40 }) });
    let finishChild: () => void = () => undefined;
    const childMayFinish = new Promise<void>((resolve) => {
      finishChild = resolve;
    });
    let timedOut: Record<string, unknown> = {};
    w.agents.queue('build', async (agent) => {
      timedOut = parse(
        await agent.call('delegate_task', {
          brief: 'Run the slow suite.',
          role: 'reviewer',
          mode: 'wait',
          timeout_minutes: 1,
        })
      );
    });
    w.agents.queue('build', async (agent) => {
      expect(agent.prompt).toContain('The slow suite passed.');
      agent.write('a.txt', 'slow\n');
      await agent.call('complete_phase', phaseReport('Done after the suite.'));
    });
    w.agents.queue('reviewer', async (agent) => {
      await childMayFinish;
      agent.say('The slow suite passed.');
    });
    const taskId = await w.createTask();
    await w.until('the wait to time out', () => timedOut.wait_timed_out === true);
    expect(timedOut).toMatchObject({ status: 'running', result: null });
    const builder = stepRun(w, taskId, 'build');
    await w.until('the parent to wait', () => w.state.runs[builder?.id ?? '']?.status === 'waiting');
    expect(w.state.runs[builder?.id ?? '']?.waitingOn).toBeTruthy();
    expect(w.activeRuns(taskId).map((run) => run.id)).toEqual([builder?.id ?? '']);
    finishChild();
    await w.untilStage(taskId, 'awaiting_review');
    const [first, woken] = w.agents.of('build');
    expect(woken?.resume).toBe(first?.sessionId ?? '');
    expect(woken?.prompt).toContain('Shinsa is reporting on work you delegated.');
    expect(w.state.runs[builder?.id ?? '']).toMatchObject({ outcome: 'completed' });
  });

  test('a delegated agent’s question goes to the agent that delegated it, never to you', async () => {
    const w = await open();
    let question = '';
    let reply = '';
    w.agents.queue('build', async (agent) => {
      const status = parse(
        await agent.call('delegate_task', { brief: 'Name the greeting.', role: 'reviewer' })
      );
      question = await nextSteer(agent);
      await agent.call('delegation_answer', {
        delegation_id: status.delegation_id,
        answer: 'Call it hello.',
      });
      await nextSteer(agent, 1);
      agent.write('a.txt', 'hello\n');
      await agent.call('complete_phase', phaseReport('Named it.'));
    });
    w.agents.queue('reviewer', async (agent) => {
      reply = await agent.call('ask', {
        question: 'What should the greeting be called?',
        context: 'Two names fit.',
      });
      agent.say('Named it hello.');
    });
    const taskId = await w.createTask();
    await w.until('the question to reach the parent', () => question.length > 0);
    expect(question).toContain('What should the greeting be called?');
    expect(listOpenGates(w.state, taskId)).toEqual([]);
    await w.untilStage(taskId, 'awaiting_review');
    expect(reply).toBe('The agent that delegated this work to you answered: Call it hello.');
    const [child] = delegated(w, taskId);
    expect(child?.delegation?.question).toMatchObject({ answer: 'Call it hello.' });
    expect(Object.values(w.state.gates).filter((gate) => gate.type === 'question')).toEqual([]);
  });

  test('the agent cannot delegate to one that changes files while it plans', async () => {
    const w = await open();
    let refusal = '';
    w.agents.queue('plan', async (agent) => {
      try {
        await agent.call('delegate_task', { brief: 'Write the files.', role: 'builder' });
      } catch (error) {
        refusal = error instanceof Error ? error.message : String(error);
      }
      await agent.call('propose_plan', toolPlan(PLAN));
    });
    const taskId = await w.createTask();
    await w.until('the refusal', () => refusal.length > 0);
    expect(refusal).toBe(
      'While you plan you cannot change files, so the agents you delegate to cannot either. Delegate to a planner or a reviewer.'
    );
    expect(delegated(w, taskId)).toEqual([]);
  });

  test('delegation nests three deep, and the deepest agent is told to do the work itself', async () => {
    const w = await open();
    let refusal = '';
    const chain = async (agent: AgentContext, label: string) => {
      await agent.call('delegate_task', { brief: `Level below ${label}.`, role: 'reviewer' });
      const result = await nextSteer(agent);
      agent.say(`${label} heard: ${result.includes('did it myself') ? 'did it myself' : 'nothing'}`);
    };
    w.agents.queue('build', async (agent) => {
      await agent.call('delegate_task', { brief: 'Level one.', role: 'reviewer' });
      await nextSteer(agent);
      agent.write('a.txt', 'deep\n');
      await agent.call('complete_phase', phaseReport('Done deep.'));
    });
    w.agents.queue(
      'reviewer',
      (agent) => chain(agent, 'one'),
      (agent) => chain(agent, 'two'),
      async (agent) => {
        try {
          await agent.call('delegate_task', { brief: 'Level four.', role: 'reviewer' });
        } catch (error) {
          refusal = error instanceof Error ? error.message : String(error);
        }
        agent.say('I did it myself.');
      }
    );
    const taskId = await w.createTask();
    await w.untilStage(taskId, 'awaiting_review');
    expect(refusal).toBe(
      'Delegations nest at most 3 deep, and this agent is already at that depth. Do the work yourself.'
    );
    expect(delegated(w, taskId).map((run) => run.delegation?.depth)).toEqual([1, 2, 3]);
    expect(delegated(w, taskId).every((run) => run.outcome === 'completed')).toBe(true);
  });

  test('a restart mid-delegation brings the delegation back, and its result still reaches the parent once', async () => {
    const w = await open();
    let childId = '';
    const steers: string[] = [];
    w.agents.queue(
      'build',
      async (agent) => {
        childId = String(
          parse(await agent.call('delegate_task', { brief: 'Survey it.', role: 'reviewer' })).delegation_id
        );
        await agent.hang();
      },
      async (agent) => {
        steers.push(await nextSteer(agent));
        agent.write('a.txt', 'survived\n');
        await agent.call('complete_phase', phaseReport('Done after the restart.'));
      }
    );
    w.agents.queue(
      'reviewer',
      async (agent) => {
        await agent.hang();
      },
      async (agent) => {
        expect(agent.resumed).toBe(true);
        agent.say('Surveyed after the restart.');
      }
    );
    const taskId = await w.createTask();
    await w.until('the delegation to start', () => w.agents.of('reviewer').length === 1);
    await w.restartGracefully();
    await w.untilStage(taskId, 'awaiting_review');
    expect(steers).toHaveLength(1);
    expect(steers[0]).toContain('Surveyed after the restart.');
    expect(w.state.runs[childId]).toMatchObject({
      outcome: 'completed',
      summary: 'Surveyed after the restart.',
    });
    expect(w.state.runs[childId]?.delegation?.delivery).toBe('delivered');
    expect(delegated(w, taskId)).toHaveLength(1);
  });

  test('stopping a delegation stops what it delegated in turn, and the parent hears it was stopped', async () => {
    const w = await open();
    let steered = '';
    let childId = '';
    w.agents.queue('build', async (agent) => {
      childId = String(
        parse(await agent.call('delegate_task', { brief: 'Look around.', role: 'reviewer' })).delegation_id
      );
      steered = await nextSteer(agent);
      agent.write('a.txt', 'stopped\n');
      await agent.call('complete_phase', phaseReport('Carried on without it.'));
    });
    w.agents.queue(
      'reviewer',
      async (agent) => {
        await agent.call('delegate_task', { brief: 'Look further.', role: 'reviewer' });
        await agent.hang();
      },
      async (agent) => {
        await agent.hang();
      }
    );
    const taskId = await w.createTask();
    await w.until('both delegations to run', () => w.agents.of('reviewer').length === 2);
    await w.engine.dispatch({ type: 'delegation.cancel', runId: childId });
    await w.until('the parent to hear', () => steered.length > 0);
    const [child, grandchild] = delegated(w, taskId);
    expect(child).toMatchObject({ id: childId, outcome: 'cancelled' });
    expect(grandchild).toMatchObject({ outcome: 'cancelled' });
    expect(listChildRuns(w.state, childId).map((run) => run.id)).toEqual([grandchild?.id ?? '']);
    expect(w.agents.of('reviewer').every((session) => session.cancelled)).toBe(true);
    expect(steered).toContain('Look around');
    await w.untilStage(taskId, 'awaiting_review');
  });

  test('a delegation in its own checkout starts from the parent’s commit and leaves its changes for the parent', async () => {
    const w = await open();
    let steered = '';
    w.agents.queue('build', async (agent) => {
      agent.write('a.txt', 'committed\n');
      await agent.call('delegate_task', {
        brief: 'Try another wording.',
        role: 'builder',
        isolation: 'worktree',
      });
      steered = await nextSteer(agent);
      await agent.call('complete_phase', phaseReport('Kept mine.'));
    });
    let cwd = '';
    w.agents.queue('builder', async (agent) => {
      cwd = agent.cwd;
      agent.write('a.txt', 'another wording\n');
      agent.say('Tried it.');
    });
    const taskId = await w.createTask();
    await w.until('the parent to hear', () => steered.length > 0);
    expect(cwd).toContain(`${w.config.worktreesDir}/delegations/${taskId}/`);
    expect(steered).toContain('Its changes are not committed: 1 file in its own checkout');
    await w.untilStage(taskId, 'awaiting_review');
  });
});

describe('filing work in another repository', () => {
  test('an agent files the other part in a repository of the project folder that Shinsa had not registered', async () => {
    const w = await open();
    await createGitRepo({ root: w.root, name: 'docs', remote: false });
    await w.engine.dispatch({
      type: 'project.write',
      project: { name: 'Superwall', color: 'blue', folders: [w.root] },
    });
    const projectId = Object.keys(w.state.projects)[0] ?? '';
    let reply = '';
    w.agents.queue('plan', async (agent) => {
      reply = await agent.call('create_task', {
        request: 'Document the agent login in the docs.',
        repository: 'docs',
        after_this: true,
      });
      await agent.call('propose_plan', toolPlan(PLAN));
    });
    await w.engine.dispatch({
      type: 'task.create',
      request: 'Add the agent login',
      repoId: w.repoId,
      projectId,
    });
    await w.until('the courier', () => reply.length > 0);
    const docs = Object.values(w.state.repos).find((repo) => repo.name === 'docs');
    expect(docs?.projectId).toBe(projectId);
    const courier = Object.values(w.state.tasks).find((task) => task.createdBy?.kind === 'courier');
    expect(courier?.repoId).toBe(docs?.id);
    expect(reply).toContain('Created.');
  });
});
