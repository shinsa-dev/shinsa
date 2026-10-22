import { describe, expect, spyOn, test } from 'bun:test';
import { describeFailure, runCommand, runCommandOrThrow } from '../../src/shell/index.ts';
import { createTempDir } from '../helpers/index.ts';

describe('runCommand', () => {
  test('captures trimmed output, the exit code and stdin', async () => {
    const result = await runCommand(['sh', '-c', 'cat; echo err >&2; exit 3'], createTempDir(), {
      input: 'hello\n',
    });
    expect(result).toEqual({ ok: false, code: 3, stdout: 'hello', stderr: 'err', timedOut: false });
  });

  test('never prompts and passes extra environment', async () => {
    const result = await runCommand(
      ['sh', '-c', 'echo "$GIT_TERMINAL_PROMPT $GIT_OPTIONAL_LOCKS $GH_PROMPT_DISABLED $EXTRA"'],
      createTempDir(),
      { env: { EXTRA: 'yes' } }
    );
    expect(result.stdout).toBe('0 0 1 yes');
  });

  test('a command that runs too long is stopped with everything it started', async () => {
    const started = Date.now();
    const result = await runCommand(['sh', '-c', 'sleep 30 & sleep 30'], createTempDir(), { timeoutMs: 100 });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
  });

  test('a process that is already gone when the timeout fires is only logged', async () => {
    const kill = spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('ESRCH');
    });
    const result = await runCommand(['sh', '-c', 'sleep 0.3'], createTempDir(), { timeoutMs: 20 });
    kill.mockRestore();
    expect(result.timedOut).toBe(true);
  });
});

test('a program that is not installed, or a missing directory, is a failed result', async () => {
  const missing = await runCommand(['shinsa-no-such-program'], createTempDir());
  expect(missing).toMatchObject({ ok: false, code: 127, stdout: '', timedOut: false });
  expect(missing.stderr.length).toBeGreaterThan(0);
  expect((await runCommand(['echo'], '/no/such/dir')).ok).toBe(false);
});

describe('runCommandOrThrow', () => {
  test('returns stdout, or throws with the reason', async () => {
    const cwd = createTempDir();
    expect(await runCommandOrThrow(['echo', 'hi'], cwd)).toBe('hi');
    expect(runCommandOrThrow(['sh', '-c', 'echo nope >&2; exit 1'], cwd)).rejects.toThrow(
      'sh -c echo nope >&2; exit 1 failed: nope'
    );
    expect(runCommandOrThrow(['sh', '-c', 'echo out; exit 1'], cwd)).rejects.toThrow('failed: out');
    expect(runCommandOrThrow(['sh', '-c', 'exit 4'], cwd)).rejects.toThrow('failed: exit 4');
  });
});

describe('describeFailure', () => {
  test('says when a command was stopped and redacts secrets', () => {
    const base = { ok: false, code: 1, stdout: '', stderr: '', timedOut: true };
    expect(describeFailure(['git', 'push'], base)).toBe('git push failed: it ran too long and was stopped');
    expect(
      describeFailure(['git', 'push'], {
        ...base,
        timedOut: false,
        stderr: 'https://t:x@github.com/a/b denied',
      })
    ).toBe('git push failed: https://***@github.com/a/b denied');
  });
});
