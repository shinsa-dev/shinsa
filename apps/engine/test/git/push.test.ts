import { describe, expect, setDefaultTimeout, test } from 'bun:test';
import { chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { Checkout } from '../../src/git/checkout/service.ts';
import { classifyPushFailure, describeShortFailure, resolveOutputTail } from '../../src/git/remote/output.ts';
import { PushError } from '../../src/git/remote/schema.ts';
import { Remote } from '../../src/git/remote/service.ts';
import { TaskGitHub } from '../../src/github/identity/schema.ts';
import { commitWorktree, runGit } from '../helpers/git.ts';
import { createGitRepo, git, writeFiles } from '../helpers/index.ts';

setDefaultTimeout(30_000);

const pushBranch = (path: string, branch: string, signal?: AbortSignal) =>
  runGit(Remote.use((remote) => remote.pushBranch(path, branch, signal)));
const hasPrePushHook = (cwd: string, signal?: AbortSignal) =>
  runGit(Remote.use((remote) => remote.hasPrePushHook(cwd, signal)));

const HOOK_OUTPUT = [
  '@shinsa/engine#test: FAIL test/a.test.ts > adds',
  '@shinsa/engine#test: ERROR: command finished with error',
  "error: failed to push some refs to 'github.com:acme/app.git'",
].join('\n');

function writeHook(path: string, script: string) {
  writeFiles(path, { '.git/hooks/pre-push': `#!/bin/sh\n${script}\n` });
  chmodSync(join(path, '.git/hooks/pre-push'), 0o755);
}

async function captureError(work: Promise<unknown>) {
  try {
    await work;
  } catch (error) {
    return error;
  }
  throw new Error('expected the push to fail');
}

describe('classifyPushFailure', () => {
  test('a pre-push hook that exits non-zero is the hook, never the network, even when its tests mention one', () => {
    expect(classifyPushFailure(HOOK_OUTPUT, true)).toBe('hook');
    expect(
      classifyPushFailure(
        `error: connect ECONNREFUSED 127.0.0.1:5432 connection refused\n${HOOK_OUTPUT}`,
        true
      )
    ).toBe('hook');
    expect(classifyPushFailure('husky - pre-push script failed (code 1)', true)).toBe('hook');
    expect(classifyPushFailure(HOOK_OUTPUT, false)).toBe('other');
  });

  test('git’s own network, auth and remote-unavailable lines are the network', () => {
    for (const output of [
      "fatal: unable to access 'https://github.com/acme/app.git/': Could not resolve host: github.com",
      'ssh: connect to host github.com port 22: Operation timed out\nfatal: Could not read from remote repository.',
      'error: RPC failed; HTTP 502 curl 22 The requested URL returned error: 502',
      "fatal: Authentication failed for 'https://github.com/acme/app.git/'",
    ]) {
      expect(classifyPushFailure(output, true)).toBe('network');
    }
  });

  test('a rejected update is non-fast-forward; a remote rule that declines it is something else', () => {
    expect(classifyPushFailure(' ! [rejected]        HEAD -> main (fetch first)', true)).toBe(
      'non_fast_forward'
    );
    expect(classifyPushFailure(' ! [rejected]        HEAD -> main (non-fast-forward)', false)).toBe(
      'non_fast_forward'
    );
    expect(classifyPushFailure(' ! [rejected]        HEAD -> main (stale info)', false)).toBe(
      'non_fast_forward'
    );
    expect(
      classifyPushFailure(' ! [remote rejected] HEAD -> main (protected branch hook declined)', true)
    ).toBe('other');
  });
});

describe('describeShortFailure', () => {
  test('keeps the line a person reads, without git’s prefixes, cut to a short length', () => {
    expect(
      describeShortFailure(
        "git push --quiet failed: fatal: unable to access 'https://github.com/a/b.git/': Could not resolve host: github.com"
      )
    ).toBe('Could not resolve host: github.com');
    expect(describeShortFailure('hint: try again\nerror: something broke')).toBe('something broke');
    expect(describeShortFailure('')).toBe('it failed with no output');
    expect(describeShortFailure('x'.repeat(300))).toHaveLength(160);
  });
});

describe('resolveOutputTail', () => {
  test('keeps the last lines without colours and caps the characters', () => {
    const lines = Array.from({ length: 100 }, (_, index) => `line ${index}`).join('\n');
    expect(resolveOutputTail(lines).split('\n')).toHaveLength(80);
    expect(resolveOutputTail(`\u001b[31mred\u001b[0m\n`)).toBe('red');
    const long = resolveOutputTail('y'.repeat(7_000));
    expect(long).toStartWith('…');
    expect(long).toHaveLength(6_001);
  });
});

describe('hasPrePushHook', () => {
  test('finds an executable hook, follows core.hooksPath and asks husky for the hook behind its stub', async () => {
    const { path } = await createGitRepo({ remote: false });
    expect(await hasPrePushHook(path)).toBe(false);
    writeFiles(path, { '.git/hooks/pre-push': '#!/bin/sh\n' });
    expect(await hasPrePushHook(path)).toBe(false);
    chmodSync(join(path, '.git/hooks/pre-push'), 0o755);
    expect(await hasPrePushHook(path)).toBe(true);

    await git(path, 'config', 'core.hooksPath', '.husky/_');
    mkdirSync(join(path, '.husky/_'), { recursive: true });
    writeFiles(path, { '.husky/_/pre-push': '#!/bin/sh\n. "$(dirname "$0")/h"\n' });
    chmodSync(join(path, '.husky/_/pre-push'), 0o755);
    expect(await hasPrePushHook(path)).toBe(false);
    writeFiles(path, { '.husky/pre-push': 'bun run test\n' });
    expect(await hasPrePushHook(path)).toBe(true);
    expect(await hasPrePushHook(join(path, 'missing'))).toBe(false);
  });
});

describe('pushBranch', () => {
  test('a hook that fails throws a hook PushError with its output, and nothing reaches the remote', async () => {
    const { path, origin } = await createGitRepo();
    writeHook(path, 'echo "FAIL test/a.test.ts > adds"\nexit 1');
    writeFiles(path, { 'a.txt': 'a' });
    await commitWorktree(path, 'feat: a');
    const error = await captureError(pushBranch(path, 'feat/a'));
    expect(error).toBeInstanceOf(PushError);
    expect(error).toMatchObject({ kind: 'hook', detail: 'the pre-push hook failed' });
    expect((error as PushError).output).toContain('FAIL test/a.test.ts > adds');
    expect(await git(origin, 'branch', '--list', 'feat/a')).toBe('');
  });

  test('a remote that cannot be reached is the network, with the line that says why', async () => {
    const { path } = await createGitRepo({ remote: false });
    await git(path, 'remote', 'add', 'origin', 'https://127.0.0.1:1/acme/app.git');
    const error = await captureError(pushBranch(path, 'feat/a'));
    expect(error).toMatchObject({ kind: 'network' });
    expect((error as PushError).detail).toStartWith('Failed to connect to 127.0.0.1 port 1');
  });

  test('a branch someone else moved on the remote is non-fast-forward', async () => {
    const { path, origin, root } = await createGitRepo();
    const other = join(root, 'other');
    await git(root, 'clone', '-q', origin, other);
    writeFiles(other, { 'b.txt': 'b' });
    await git(other, 'add', '-A');
    await git(other, 'commit', '-q', '-m', 'feat: b');
    await git(other, 'push', '-q', 'origin', 'main');
    writeFiles(path, { 'a.txt': 'a' });
    await commitWorktree(path, 'feat: a');
    const error = await captureError(pushBranch(path, 'main'));
    expect(error).toMatchObject({ kind: 'non_fast_forward' });
  });
});

describe('a task owner’s GitHub identity', () => {
  const KAI = { token: 'ghp_kai', login: 'kai', name: 'Kai Lane', email: '7+kai@users.noreply.github.com' };
  const asKai = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.provideService(effect, TaskGitHub, { identity: KAI, missing: null });

  test('a push sends the owner’s token as GitHub’s header, and a push without one sends none', async () => {
    const { path, origin } = await createGitRepo();
    const seen = join(path, '.git', 'header');
    writeHook(path, `git config --get http.https://github.com/.extraheader > "${seen}" || true`);
    writeFiles(path, { 'a.txt': 'a' });
    await commitWorktree(path, 'feat: a');
    await runGit(asKai(Remote.use((remote) => remote.pushBranch(path, 'feat/a'))));
    const basic = Buffer.from('x-access-token:ghp_kai').toString('base64');
    expect(readFileSync(seen, 'utf8').trim()).toBe(`Authorization: Basic ${basic}`);
    expect(await git(origin, 'branch', '--list', 'feat/a')).toContain('feat/a');
    await pushBranch(path, 'feat/b');
    expect(readFileSync(seen, 'utf8').trim()).toBe('');
  });

  test('a commit is authored as the owner, and the machine’s own name stays the committer', async () => {
    const { path } = await createGitRepo({ remote: false });
    writeFiles(path, { 'a.txt': 'a' });
    await runGit(asKai(Checkout.use((checkout) => checkout.commit(path, 'feat: a'))));
    expect(await git(path, 'log', '-1', '--format=%an <%ae>')).toBe(
      'Kai Lane <7+kai@users.noreply.github.com>'
    );
    expect(await git(path, 'log', '-1', '--format=%cn')).not.toBe('Kai Lane');
  });
});
