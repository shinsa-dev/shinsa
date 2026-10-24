import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Run, replayEventLog, type ShinsaState } from '@shinsa/core';
import { Engine } from '../../src/runtime/index.ts';
import { runCommandOrThrow } from '../../src/shell/index.ts';
import { EventLog } from '../../src/store/index.ts';
import { createRandom } from '../helpers/random.ts';
import { World } from './harness.ts';

setDefaultTimeout(240_000);

const FIRST_SEED = Number(Bun.env.SOAK_FIRST_SEED ?? 1);

const SEEDS = Number(Bun.env.SOAK_SEEDS ?? 3);

const KILLS = Number(Bun.env.SOAK_KILLS ?? 10);

const CHILD = join(import.meta.dirname, 'soak', 'child.ts');

const INTENTS = ['Add the greeting files', 'Add the farewell files'];

const CANCELLED_INTENT = 'Add the files you will cancel';

let world: World | null = null;

afterEach(async () => {
  await world?.dispose();
  world = null;
});

interface Life {
  settled: boolean;
  output: string;
}

async function live(
  root: string,
  seed: number,
  killAfterMs: number | null,
  cancelStage: number
): Promise<Life> {
  const child = Bun.spawn(['bun', CHILD], {
    env: {
      ...process.env,
      SOAK_ROOT: root,
      SOAK_SEED: String(seed),
      SOAK_CANCEL_INTENT: CANCELLED_INTENT,
      SOAK_CANCEL_STAGE: String(cancelStage),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const output = new Response(child.stdout).text();
  const errors = new Response(child.stderr).text();
  const deadline = killAfterMs ?? 20_000;
  const timer = setTimeout(() => child.kill('SIGKILL'), deadline);
  const code = await child.exited;
  clearTimeout(timer);
  const text = `${await output}${await errors}`;
  return { settled: code === 0 && text.includes('SETTLED'), output: text };
}

function readLog(path: string) {
  const log = new EventLog(path);
  try {
    return { read: log.readEvents(), effects: log.listEffectStatuses() };
  } finally {
    log.close();
  }
}

async function listLines(cwd: string, ...args: string[]) {
  return (await runCommandOrThrow(['git', ...args], cwd)).split('\n').filter(Boolean);
}

function describeState(state: ShinsaState) {
  return Object.values(state.tasks)
    .map((task) => {
      const gates = Object.values(state.gates)
        .filter((gate) => gate.taskId === task.id && gate.status === 'open')
        .map((gate) => `${gate.purpose}:${gate.title}:${gate.body ?? ''}`);
      const activity = task.activity
        .slice(-14)
        .map(
          (entry) =>
            `    ${entry.actor}: ${entry.text}${entry.detail ? ` [${entry.detail.slice(0, 200)}]` : ''}`
        );
      return [`${task.title}: ${task.stage} (${task.stageReason}) ${gates.join(' | ')}`, ...activity].join(
        '\n'
      );
    })
    .join('\n');
}

function describeLog(w: World) {
  const { read, effects } = readLog(w.config.databasePath);
  const { state } = replayEventLog(read.events);
  const open = effects
    .filter((effect) => effect.status !== 'done')
    .map((effect) => `${effect.kind}:${effect.status}`);
  const runs = Object.values(state.runs).map(
    (run) => `${run.role}:${run.phaseIndex ?? '-'}:${run.status}:${run.outcome ?? 'active'}`
  );
  return `${describeState(state)}\neffects: ${open.join(', ')}\nruns: ${runs.join(', ')}\nlast events: ${read.events
    .slice(-12)
    .map((event) => event.type)
    .join(', ')}`;
}

function readReceipts(w: World) {
  const outbox = JSON.parse(readFileSync(join(w.root, 'client-outbox.json'), 'utf8')) as { id: string }[];
  const log = new EventLog(w.config.databasePath);
  try {
    return outbox.map((entry) => ({ id: entry.id, receipt: log.selectReceipt(entry.id) }));
  } finally {
    log.close();
  }
}

function assertReceipts(w: World, read: ReturnType<typeof readLog>['read'], outputs: string[]) {
  const failed = new Set(
    outputs
      .flatMap((output) => output.split('\n'))
      .flatMap((line) => /^(?:command|resend) failed: (\S+) /.exec(line)?.[1] ?? [])
  );
  const receipts = readReceipts(w);
  expect(receipts.filter((entry) => entry.receipt === null)).toEqual([]);
  expect(
    receipts
      .filter((entry) => failed.has(entry.id) && entry.receipt?.status !== 'rejected')
      .map((entry) => entry.id)
  ).toEqual([]);
  const answered = read.events.flatMap((event) => (event.type === 'gate.answered' ? [event.gateId] : []));
  expect(answered.length).toBe(new Set(answered).size);
  const cancels = read.events.filter((event) => event.type === 'task.staged' && event.stage === 'cancelled');
  expect(cancels).toHaveLength(1);
}

async function assertConsistent(w: World, lives: number, outputs: string[]) {
  const { read, effects } = readLog(w.config.databasePath);
  expect(read.unreadable).toEqual([]);
  const { state, failures } = replayEventLog(read.events);
  expect(failures).toEqual([]);
  assertReceipts(w, read, outputs);
  const all = Object.values(state.tasks);
  const cancelled = all.filter((task) => task.intent === CANCELLED_INTENT);
  expect(cancelled.map((task) => [task.stage, task.worktreePath, task.pullRequest])).toEqual([
    ['cancelled', null, null],
  ]);
  const tasks = all.filter((task) => task.intent !== CANCELLED_INTENT);
  if (tasks.some((task) => task.stage !== 'merged')) {
    throw new Error(`Not merged after ${lives} lives\n${describeLog(w)}`);
  }
  const isCrashLoop = (run: Run | undefined) => run?.failure?.code === 'crash_loop';
  const failureGates = Object.values(state.gates).filter(
    (gate) => gate.purpose === 'failure' && !isCrashLoop(state.runs[gate.runId ?? ''])
  );
  expect(failureGates.map((gate) => `${gate.title}: ${gate.body}`)).toEqual([]);
  expect(Object.values(state.gates).filter((gate) => gate.status === 'open')).toEqual([]);
  expect(Object.values(state.runs).filter((run) => run.endedAt === null)).toEqual([]);
  expect(Object.values(state.runs).filter((run) => run.outcome === 'failed' && !isCrashLoop(run))).toEqual(
    []
  );
  for (const task of all) {
    const completed = Object.values(state.runs).filter(
      (run) => run.taskId === task.id && run.outcome === 'completed'
    );
    const steps = completed.map((run) => `${run.role}:${run.phaseIndex ?? '-'}`);
    expect(steps.length).toBe(new Set(steps).size);
    expect(task.worktreePath).toBeNull();
  }
  expect(effects.filter((effect) => effect.status === 'failed')).toEqual([]);
  expect(effects.filter((effect) => effect.status === 'pending' || effect.status === 'running')).toEqual([]);

  const pulls = w.github.pulls;
  expect(pulls).toHaveLength(tasks.length);
  expect(new Set(pulls.map((pull) => pull.head)).size).toBe(tasks.length);
  expect(pulls.every((pull) => pull.state === 'MERGED')).toBe(true);
  for (const task of tasks) {
    const pull = pulls.find((candidate) => candidate.head === task.branch);
    expect(pull?.number).toBe(task.pullRequest?.number);
    const commits = await listLines(w.origin, 'log', '--format=%s', `main..${task.branch}`);
    expect(commits.map((subject) => subject.replace(/^\w+: /, ''))).toEqual([
      'write the second file',
      'write the first file',
    ]);
  }
  const branches = await listLines(w.repoPath, 'branch', '--format=%(refname:short)');
  expect(branches.sort()).toEqual(['main', ...all.map((task) => task.branch ?? '')].sort());
  const worktrees = await listLines(w.repoPath, 'worktree', 'list', '--porcelain');
  expect(worktrees.filter((line) => line.startsWith('worktree '))).toHaveLength(1);
  const left = existsSync(w.config.worktreesDir)
    ? readdirSync(w.config.worktreesDir).flatMap((repo) => readdirSync(join(w.config.worktreesDir, repo)))
    : [];
  expect(left).toEqual([]);
}

describe('crash and restart soak', () => {
  for (let seed = FIRST_SEED; seed < FIRST_SEED + SEEDS; seed += 1) {
    test(`seed ${seed}: killed ${KILLS} times at random points, every task still lands once`, async () => {
      const random = createRandom(seed * 104_729);
      const w = await World.create();
      world = w;
      w.daemon.stop();
      await w.daemon.engine.settle();
      const seeding = new Engine(new EventLog(w.config.databasePath));
      for (const intent of [...INTENTS, CANCELLED_INTENT]) {
        await seeding.dispatch({ type: 'task.create', intent, repoId: w.repoId });
      }
      const github = JSON.parse(readFileSync(w.github.path, 'utf8'));
      writeFileSync(w.github.path, JSON.stringify({ ...github, defaultChecks: 'passing' }));
      let lives = 0;
      let settled = false;
      const outputs: string[] = [];
      for (let kill = 0; kill < KILLS && !settled; kill += 1) {
        const life = await live(w.root, seed * 1000 + kill, 60 + Math.floor(random.next() * 900), seed);
        lives += 1;
        settled = life.settled;
        outputs.push(life.output);
      }
      if (!settled) {
        const last = await live(w.root, seed * 1000 + KILLS, null, seed);
        lives += 1;
        outputs.push(last.output);
        if (!last.settled) throw new Error(`Never settled after ${lives} lives\n${describeLog(w)}`);
      }
      await assertConsistent(w, lives, outputs);
    });
  }
});
