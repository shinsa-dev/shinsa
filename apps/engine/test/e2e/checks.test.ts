import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlanCheck } from '@shinsa/core';
import { type AgentScript, PLAN, toolPlan, World } from './harness.ts';

setDefaultTimeout(60_000);

let world: World | null = null;

afterEach(async () => {
  await world?.dispose();
  world = null;
});

async function open(options: Parameters<typeof World.create>[0] = {}) {
  world = await World.create({ checks: [], ...options });
  return world;
}

function logged(w: World, id: string, script: string) {
  return `echo ${id} >> ${join(w.root, 'ran.log')}; ${script}`;
}

function readRan(w: World) {
  const path = join(w.root, 'ran.log');
  return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n') : [];
}

function planWith(verification: PlanCheck[]): AgentScript {
  return async (agent) => {
    await agent.call('propose_plan', toolPlan({ ...PLAN, verification }));
  };
}

function build(file: string, content: string, extra: Record<string, unknown> = {}): AgentScript {
  return async (agent) => {
    agent.write(file, content);
    await agent.call('complete_phase', {
      summary: `Wrote ${file}.`,
      spots: [{ file, start: 1, end: 1, attention: 'normal', why: 'The new file.' }],
      judgement_calls: [],
      ...extra,
    });
  };
}

const BROKEN_TEST = `import { expect, test } from 'bun:test';
test('is broken on main', () => {
  expect(1).toBe(2);
});
`;

const NEWLY_BROKEN_TEST = `${BROKEN_TEST}test('is broken by the change', () => {
  expect(2).toBe(3);
});
`;

const PASSING_TEST = `import { expect, test } from 'bun:test';
test('passes', () => {
  expect(1).toBe(1);
});
`;

const LOAD_SENSITIVE_TEST = `import { expect, test } from 'bun:test';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
test('times out under load', () => {
  const marker = new URL('./alone', import.meta.url).pathname;
  const alone = existsSync(marker);
  if (alone) rmSync(marker);
  else writeFileSync(marker, '');
  expect(alone).toBe(true);
});
`;

describe('the checks an agent plans', () => {
  test('each phase runs only the checks that cover it, and the repository’s run once before review', async () => {
    const w = await open({ checks: ['true'] });
    w.agents.queue(
      'plan',
      planWith([
        { label: 'First file', command: logged(w, 'c1', 'test -f a.txt'), phases: [1] },
        { label: 'Second file', command: logged(w, 'c2', 'test -f b.txt'), phases: [2] },
      ])
    );
    const taskId = await w.createTask();
    await w.untilStage(taskId, 'awaiting_review');
    expect(readRan(w)).toEqual(['c1', 'c2']);
    expect(w.task(taskId).checkResults?.map((check) => [check.id, check.outcome])).toEqual([
      ['c1', 'pass'],
      ['c2', 'pass'],
      ['r1', 'pass'],
    ]);
  });

  test('a check the agent adds while it builds runs right away and after the phases it covers', async () => {
    const w = await open();
    w.agents.queue(
      'plan',
      planWith([{ label: 'First file', command: logged(w, 'c1', 'test -f a.txt'), phases: [1] }])
    );
    const added = {
      action: 'add',
      label: 'Greeting text',
      command: logged(w, 'c2', 'grep -q hello a.txt'),
      reason: 'The greeting text is what the request asks for.',
    };
    w.agents.queue(
      'build',
      build('a.txt', 'hello\n', { check_changes: [added] }),
      build('b.txt', 'phase 2\n')
    );
    const taskId = await w.createTask();
    await w.untilStage(taskId, 'awaiting_review');
    expect(w.task(taskId).checks?.find((check) => check.id === 'c2')).toMatchObject({
      label: 'Greeting text',
      phases: [1, 2],
      source: 'agent',
    });
    expect(readRan(w).sort()).toEqual(['c1', 'c2', 'c2']);
  });

  test('a fix runs the checks that failed and those of the phases whose files it changed', async () => {
    const w = await open();
    w.agents.queue(
      'plan',
      planWith([
        { label: 'First file', command: logged(w, 'c1', 'test -f a.txt'), phases: [1, 2] },
        { label: 'Fixed text', command: logged(w, 'c2', 'grep -q fixed a.txt'), phases: [2] },
      ])
    );
    w.agents.queue('fix', async (agent) => {
      agent.write('a.txt', 'fixed\n');
      await agent.call('complete_fix', { summary: 'Wrote the fixed text.' });
    });
    const taskId = await w.createTask();
    await w.untilStage(taskId, 'awaiting_review');
    expect(w.agents.of('fix')).toHaveLength(1);
    expect(w.agents.of('fix')[0]?.prompt).toContain('The checks failed');
    expect(readRan(w).sort()).toEqual(['c1', 'c1', 'c1', 'c2', 'c2']);
  });

  test('a fix of the changes you ask for runs the checks of the phases whose files it touched', async () => {
    const w = await open();
    w.agents.queue(
      'plan',
      planWith([
        { label: 'First file', command: logged(w, 'c1', 'test -f a.txt'), phases: [1] },
        { label: 'Second file', command: logged(w, 'c2', 'test -f b.txt'), phases: [2] },
      ])
    );
    w.agents.queue(
      'fix',
      async (agent) => {
        agent.write('a.txt', 'renamed\n');
        await agent.call('complete_fix', { summary: 'Renamed the greeting.' });
      },
      async (agent) => {
        agent.write('notes.txt', 'notes\n');
        await agent.call('complete_fix', { summary: 'Wrote the notes.' });
      }
    );
    const taskId = await w.createTask();
    await w.answer(await w.untilGate(taskId, 'review'), 'revise', 'Rename the greeting.');
    await w.until('the fix to be reviewed', () => w.agents.of('fix').length === 1);
    const gate = await w.untilGate(taskId, 'review');
    expect(readRan(w)).toEqual(['c1', 'c2', 'c1']);
    await w.answer(gate, 'revise', 'Add notes.');
    await w.until('the second fix', () => w.agents.of('fix').length === 2);
    await w.untilGate(taskId, 'review');
    expect(readRan(w)).toEqual(['c1', 'c2', 'c1']);
    expect(w.task(taskId).phaseReports.map((report) => report.files)).toEqual([['a.txt'], ['b.txt']]);
  });
});

describe('failures the change did not cause', () => {
  test('tests in the planned folder that also fail on the base commit do not block the task', async () => {
    const w = await open({
      files: {
        'package.json': '{}',
        'pkg/package.json': '{}',
        'pkg/test/broken.test.ts': BROKEN_TEST,
        'pkg/test/ok.test.ts': PASSING_TEST,
      },
    });
    w.agents.queue(
      'plan',
      planWith([{ label: 'Package tests', command: 'bun test pkg/test', phases: [1, 2] }])
    );
    const taskId = await w.createTask();
    await w.untilStage(taskId, 'awaiting_review');
    expect(w.task(taskId).checkResults).toMatchObject([{ id: 'c1', outcome: 'fail', note: 'fails_on_base' }]);
    expect(w.agents.of('fix')).toHaveLength(0);
    const output = Object.values(w.state.evidence).find(
      (item) => item.checkId === 'c1' && item.runId === null
    );
    expect(output).toMatchObject({ kind: 'check', title: 'Package tests' });
  });

  test('a new failing test in a file that already fails on the base blocks, and is named', async () => {
    const w = await open({
      files: { 'package.json': '{}', 'pkg/package.json': '{}', 'pkg/test/broken.test.ts': BROKEN_TEST },
    });
    w.agents.queue(
      'plan',
      planWith([{ label: 'Package tests', command: 'bun test pkg/test', phases: [1, 2] }])
    );
    w.agents.queue('build', build('pkg/test/broken.test.ts', NEWLY_BROKEN_TEST));
    w.agents.queue('fix', async (agent) => {
      agent.write('pkg/test/broken.test.ts', BROKEN_TEST);
      await agent.call('complete_fix', { summary: 'Fixed the new test.' });
    });
    const taskId = await w.createTask();
    await w.untilStage(taskId, 'awaiting_review');
    expect(w.agents.of('fix')[0]?.prompt).toContain(
      '1 new failing test, 1 already on the base branch:\n- pkg/test/broken.test.ts › is broken by the change'
    );
    expect(w.task(taskId).checkResults).toMatchObject([{ id: 'c1', outcome: 'fail', note: 'fails_on_base' }]);
    expect(w.task(taskId).checkResults?.[0]?.detail).toStartWith(
      '1 failing test, all already on the base branch.'
    );
  });

  test('a test file that fails in the full run and passes alone does not block the task', async () => {
    const w = await open({
      files: { 'package.json': '{}', 'test/greeting.test.ts': LOAD_SENSITIVE_TEST },
    });
    w.agents.queue('plan', planWith([{ label: 'Greeting tests', command: 'bun test test', phases: [2] }]));
    const taskId = await w.createTask();
    await w.untilStage(taskId, 'awaiting_review');
    expect(w.task(taskId).checkResults).toMatchObject([{ id: 'c1', outcome: 'pass', note: 'passed_alone' }]);
    expect(w.agents.of('fix')).toHaveLength(0);
  });
});

describe('after the pull request opens', () => {
  test('the pull request’s CI runs show on the task once the watch reads them', async () => {
    const w = await open();
    const taskId = await w.createTask();
    await w.answer(await w.untilGate(taskId, 'review'), 'approve');
    await w.until('the pull request to open', () => w.task(taskId).pullRequest !== null);
    const number = w.task(taskId).pullRequest?.number ?? 0;
    w.github.update(number, {
      checkRuns: [
        { name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS', required: true },
        { name: 'e2e', status: 'IN_PROGRESS', conclusion: null, required: false },
      ],
    });
    await w.sync(taskId);
    await w.until('the CI runs', () => (w.task(taskId).pullRequest?.checkRuns ?? []).length === 2);
    expect(w.task(taskId).pullRequest?.checkRuns?.map((run) => run.name)).toEqual(['build', 'e2e']);
  });
});
