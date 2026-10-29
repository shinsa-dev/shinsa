import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCommand, runCommandOrThrow } from '../../src/shell/index.ts';
import { World } from './harness.ts';

setDefaultTimeout(60_000);

let world: World | null = null;

afterEach(async () => {
  await world?.dispose();
  world = null;
});

async function open() {
  world = await World.create();
  return world;
}

function git(cwd: string, ...args: string[]) {
  return runCommandOrThrow(['git', ...args], cwd);
}

async function moveBase(w: World, files: Record<string, string>) {
  const other = join(w.root, 'other');
  await git(w.root, 'clone', '-q', w.origin, other);
  for (const [file, content] of Object.entries(files)) writeFileSync(join(other, file), content);
  await git(other, 'add', '-A');
  await git(other, 'commit', '-q', '-m', 'feat: move main');
  await git(other, 'push', '-q', 'origin', 'main');
}

function writeHook(w: World, script: string) {
  const path = join(w.repoPath, '.git/hooks/pre-push');
  writeFileSync(path, `#!/bin/sh\n${script}\n`);
  chmodSync(path, 0o755);
}

async function approveReview(w: World, taskId: string) {
  await w.untilStage(taskId, 'awaiting_review');
  await w.answer(await w.untilGate(taskId, 'review'), 'approve');
}

describe('updating onto the base before the push', () => {
  test('a branch behind its base gets the base merged in and is pushed without force', async () => {
    const w = await open();
    const taskId = await w.createTask();
    await w.untilStage(taskId, 'awaiting_review');
    await moveBase(w, { 'base.txt': 'from main\n' });
    await approveReview(w, taskId);
    await w.until('the pull request to open', () => w.task(taskId).pullRequest !== null);
    const branch = w.task(taskId).branch ?? '';
    const worktree = w.task(taskId).worktreePath ?? '';
    expect(await git(worktree, 'log', '-1', '--format=%s')).toBe(`Merge branch 'main' into ${branch}`);
    expect(await git(w.origin, 'rev-parse', `refs/heads/${branch}`)).toBe(
      await git(worktree, 'rev-parse', 'HEAD')
    );
    expect(await git(w.origin, 'show', `refs/heads/${branch}:base.txt`)).toBe('from main');
    expect(await git(w.origin, 'show', `refs/heads/${branch}:a.txt`)).toBe('phase 1');
  });

  test('conflicts go to the agent as a fix round; its resolution is committed, checked and pushed', async () => {
    const w = await open();
    w.agents.queue('fix', async (agent) => {
      expect(agent.prompt).toContain('The branch was being updated onto `main` before Shinsa pushed it');
      expect(agent.prompt).toContain('- a.txt');
      expect((await runCommand(['git', 'status', '--porcelain'], agent.cwd)).stdout).toBe('');
      await runCommand(['git', 'merge', 'origin/main'], agent.cwd);
      agent.write('a.txt', 'phase 1 and main\n');
      await git(agent.cwd, 'add', 'a.txt');
      await agent.call('complete_fix', { summary: 'Kept both sides of a.txt.' });
    });
    const taskId = await w.createTask();
    await w.untilStage(taskId, 'awaiting_review');
    await moveBase(w, { 'a.txt': 'from main\n' });
    await approveReview(w, taskId);
    await w.until('the pull request to open', () => w.task(taskId).pullRequest !== null);
    const task = w.task(taskId);
    expect(task.activity.map((entry) => entry.text)).toContain(
      'Fix round 1: resolving conflicts with the base branch'
    );
    expect(await git(w.origin, 'show', `refs/heads/${task.branch}:a.txt`)).toBe('phase 1 and main');
    expect(await git(task.worktreePath ?? '', 'log', '-1', '--format=%P')).toContain(' ');
  });
});

describe('the pre-push hook', () => {
  test('a hook that exits 1 goes to the agent once, is never retried, and the fixed branch is pushed', async () => {
    const w = await open();
    w.agents.queue('fix', async (agent) => {
      expect(agent.prompt).toContain("The repository's pre-push hook rejected the push");
      expect(agent.prompt).toContain('needs fixed.txt');
      agent.write('fixed.txt', 'fixed\n');
      await agent.call('complete_fix', { summary: 'Added fixed.txt.' });
    });
    writeHook(w, 'test -f fixed.txt && exit 0\necho "needs fixed.txt"\nexit 1');
    const taskId = await w.createTask();
    await approveReview(w, taskId);
    await w.until('the pull request to open', () => w.task(taskId).pullRequest !== null);
    const statuses = w.daemon.log.listEffectStatuses().filter((row) => row.kind === 'pull_request.open');
    expect(statuses.map((row) => [row.status, row.attempts])).toEqual([
      ['done', 1],
      ['done', 1],
    ]);
    expect(w.agents.of('fix')).toHaveLength(1);
    expect(w.task(taskId).activity.map((entry) => entry.text)).toContain(
      'The pre-push hook rejected the push'
    );
    expect(await git(w.origin, 'show', `refs/heads/${w.task(taskId).branch}:fixed.txt`)).toBe('fixed');
  });

  test('the same hook failure after a fix round stops at a gate that shows the output', async () => {
    const w = await open();
    writeHook(w, 'echo "the hook always fails"\nexit 1');
    const taskId = await w.createTask();
    await approveReview(w, taskId);
    const gate = await w.untilGate(taskId, 'failure');
    expect(gate).toMatchObject({ cause: 'push_hook', title: 'The pre-push hook failed again' });
    expect(gate.body).toContain('the hook always fails');
    expect(w.agents.of('fix')).toHaveLength(1);
    expect(w.task(taskId).pullRequest).toBeNull();
  });
});

describe('a remote that cannot be reached', () => {
  test('is retried, each attempt shown with when it runs and why, until the failure gate', async () => {
    const w = await open();
    const taskId = await w.createTask();
    await w.untilStage(taskId, 'awaiting_review');
    await git(w.repoPath, 'remote', 'set-url', 'origin', 'https://127.0.0.1:1/acme/app.git');
    const reasons = new Set<string>();
    const unsubscribe = w.engine.subscribe((state) => {
      const reason = state.tasks[taskId]?.stageReason;
      if (reason) reasons.add(reason);
    });
    await approveReview(w, taskId);
    const gate = await w.untilGate(taskId, 'failure');
    unsubscribe();
    expect(gate.title).toBe('Could not open the pull request');
    const retries = w
      .task(taskId)
      .activity.filter((entry) => entry.text.startsWith('Updating the branch failed'))
      .map((entry) => entry.text);
    expect(retries).toEqual(
      [1, 2, 3, 4].map((n) => `Updating the branch failed on attempt ${n} of 5, trying again in 1s`)
    );
    expect(
      [...reasons].filter((reason) => reason.startsWith('updating the branch again in 1s, attempt 2 of 5: '))
    ).toEqual([expect.stringContaining('Failed to connect to 127.0.0.1 port 1')]);
    const status = w.daemon.log.listEffectStatuses().find((row) => row.kind === 'pull_request.open');
    expect(status).toMatchObject({ status: 'failed', attempts: 5 });
  });
});

describe('a new pull request whose CI has not started yet', () => {
  test('waits for CI instead of opening the merge gate and taking it back, then merges the head you approved', async () => {
    const w = await open();
    w.github.configure({ defaultChecks: 'none', workflows: { 'test.yml': 'on: pull_request\n' } });
    const taskId = await w.createTask();
    await approveReview(w, taskId);
    await w.until('the pull request to open', () => w.task(taskId).pullRequest !== null);
    w.github.update(1, { mergeable: 'UNKNOWN' });
    await w.sync(taskId);
    expect(w.task(taskId)).toMatchObject({ stage: 'shipping', stageReason: 'waiting for CI' });
    w.github.update(1, { mergeable: 'MERGEABLE' });
    await w.sync(taskId);
    expect(w.task(taskId)).toMatchObject({ stage: 'shipping', stageReason: 'waiting for CI' });
    w.github.update(1, { checks: 'pending' });
    await w.sync(taskId);
    expect(w.task(taskId)).toMatchObject({ stage: 'shipping', stageReason: 'waiting for CI' });
    const mergeGates = () =>
      Object.values(w.state.gates).filter((entry) => entry.taskId === taskId && entry.type === 'merge');
    expect(mergeGates()).toEqual([]);

    w.github.update(1, { checks: 'passing' });
    await w.sync(taskId);
    const gate = await w.untilGate(taskId, 'merge');
    const head = (await git(w.origin, 'rev-parse', w.task(taskId).branch ?? '')).trim();
    expect(gate.commit).toBe(head);
    expect(mergeGates()).toHaveLength(1);
    const stages = w
      .task(taskId)
      .activity.filter((entry) => entry.kind === 'stage')
      .map((entry) => entry.text);
    expect(stages.filter((text) => text === 'Opening the pull request')).toHaveLength(1);
    expect(stages.at(-1)).toBe('Ready to merge');

    await w.answer(gate, 'approve');
    await w.untilStage(taskId, 'merged');
    const merge = w.github.calls.find((call) => call[0] === 'pr' && call[1] === 'merge');
    expect(merge?.slice(3, 6)).toEqual(['--squash', '--match-head-commit', head]);
    expect(merge?.slice(6, 7)).toEqual(['--subject']);
  });
});
