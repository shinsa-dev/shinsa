import { listOpenGates } from '@shinsa/core';
import { World } from '../e2e/harness.ts';

const FILES = {
  'package.json': JSON.stringify(
    { name: 'calc', private: true, type: 'module', scripts: { test: 'bun test' } },
    null,
    2
  ),
  'src/math.ts':
    'export function add(a: number, b: number) {\n  return a - b;\n}\n\nexport function average(values: number[]) {\n  return values.reduce(add, 0) / values.length;\n}\n',
  'src/math.test.ts':
    "import { expect, test } from 'bun:test';\nimport { add } from './math.ts';\n\ntest('add', () => {\n  expect(add(1, 2)).toBe(3);\n});\n",
  'CLAUDE.md': '# calc\n\nA tiny maths library. Run `bun test` to check. Keep functions pure.\n',
};

function print(...parts: unknown[]) {
  process.stdout.write(`${parts.map(String).join(' ')}\n`);
}

const started = Date.now();
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(0)}s`;
const world = await World.create({ live: true, checks: ['bun test'], files: FILES });
const seen = new Set<string>();
const timer = setInterval(() => {
  for (const task of Object.values(world.state.tasks)) {
    const line = `${task.title} — ${task.stage} (${task.stageReason})`;
    if (!seen.has(line)) {
      seen.add(line);
      print(`[${elapsed()}] ${line}`);
    }
  }
  for (const run of Object.values(world.state.runs)) {
    const line = `run ${run.role}${run.phaseIndex !== null && run.phaseIndex !== undefined ? ` phase ${run.phaseIndex + 1}` : ''} ${run.model} ${run.endedAt ? `ended ${run.outcome}: ${run.summary?.slice(0, 120) ?? ''}` : run.status}`;
    if (!seen.has(`${run.id}${line}`)) {
      seen.add(`${run.id}${line}`);
      print(`[${elapsed()}]   ${line}`);
    }
  }
}, 500);

try {
  const taskId = await world.createTask(
    'Fix add() so average() is correct, and add an average() test covering an empty list (it should return 0).'
  );
  await world.until(
    'the review gate',
    () =>
      world.state.tasks[taskId]?.stage === 'awaiting_review' ||
      listOpenGates(world.state, taskId).some((gate) => gate.purpose !== 'decision'),
    20 * 60_000
  );
  const task = world.task(taskId);
  print('\n=== RESULT ===');
  print('stage', task.stage, task.stageReason);
  print(
    'gates',
    JSON.stringify(
      listOpenGates(world.state, taskId).map((gate) => [
        gate.kind,
        gate.purpose,
        gate.title,
        gate.body.slice(0, 300),
      ])
    )
  );
  print('plan', JSON.stringify(task.spec?.document?.plan));
  print('phase reports', JSON.stringify(task.phaseReports.map((report) => report.summary)));
  print('checks', JSON.stringify(task.checkResults));
  print('findings', JSON.stringify(task.findings));
  print('fix rounds', task.fixRounds, task.fixFor);
  print('commits', JSON.stringify(await world.branchLog(task.branch ?? '')));
  print('activity', JSON.stringify(task.activity.map((entry) => entry.text)));
  if (task.stage === 'awaiting_review') {
    await world.answer(world.gates(taskId)[0]!, 'approve');
    await world.until('the pull request', () => world.task(taskId).pullRequest !== null, 60_000);
    world.github.update(1, { checks: 'passing' });
    await world.sync(taskId);
    await world.answer(await world.untilGate(taskId, 'merge'), 'approve');
    await world.untilStage(taskId, 'merged', 60_000);
    print('merged; pulls', JSON.stringify(world.github.pulls));
  }
} finally {
  clearInterval(timer);
  print(`total ${elapsed()}`);
  await world.dispose();
}
