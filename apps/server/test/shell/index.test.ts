import { describe, expect, spyOn, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '../../src/log/index.ts';
import { describeFailure, killProcessGroup, runCommand, runCommandOrThrow } from '../../src/shell/index.ts';
import { createTempDir, overrideEnv, until } from '../helpers/index.ts';

function readProcessState(pid: number) {
  return Bun.spawnSync(['ps', '-o', 'stat=', '-p', String(pid)])
    .stdout.toString()
    .trim();
}

describe('runCommand', () => {
  test('captures trimmed output, the exit code and stdin', async () => {
    const result = await runCommand(['sh', '-c', 'cat; echo err >&2; exit 3'], createTempDir(), {
      input: 'hello\n',
    });
    expect(result).toEqual({ ok: false, code: 3, stdout: 'hello', stderr: 'err', timedOut: false });
  });

  test('hands every non-blank line of both streams over as it arrives, progress redraws included', async () => {
    const lines: string[] = [];
    const result = await runCommand(
      ['sh', '-c', 'printf "one\\r\\ntwo\\rthree\\n\\n"; printf "warn\\n" >&2; printf "last"'],
      createTempDir(),
      { onLine: (line) => lines.push(line) }
    );
    expect([...lines].sort()).toEqual(['last', 'one', 'three', 'two', 'warn']);
    expect(result.stdout).toBe('one\r\ntwo\rthree\n\nlast');
    expect(result.stderr).toBe('warn');
  });

  test('never prompts and passes extra environment', async () => {
    const result = await runCommand(
      ['sh', '-c', 'echo "$GIT_TERMINAL_PROMPT $GIT_OPTIONAL_LOCKS $GH_PROMPT_DISABLED $EXTRA"'],
      createTempDir(),
      { env: { EXTRA: 'yes' } }
    );
    expect(result.stdout).toBe('0 0 1 yes');
  });

  test('a variable set to undefined is not inherited from the server’s environment', async () => {
    const restore = overrideEnv({ SHINSA_PROBE: 'inherited' });
    try {
      const result = await runCommand(['sh', '-c', 'echo "[$SHINSA_PROBE]"'], createTempDir(), {
        env: { SHINSA_PROBE: undefined },
      });
      expect(result.stdout).toBe('[]');
    } finally {
      restore();
    }
  });

  test('a command that runs too long is stopped with everything it started', async () => {
    const started = Date.now();
    const result = await runCommand(['sh', '-c', 'sleep 30 & sleep 30'], createTempDir(), { timeoutMs: 100 });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
  });

  test('a command whose effect was cancelled before it started never runs', async () => {
    const dir = createTempDir();
    const controller = new AbortController();
    controller.abort();
    const result = await runCommand(['sh', '-c', 'touch ran'], dir, { signal: controller.signal });
    expect(result.ok).toBe(false);
    expect(result.stderr).toBe('The command was cancelled before it started.');
    expect(existsSync(join(dir, 'ran'))).toBe(false);
  });

  test('a cancel while the command runs stops it with everything it started', async () => {
    const dir = createTempDir();
    const controller = new AbortController();
    const running = runCommand(['sh', '-c', 'touch started; sleep 30 & sleep 30'], dir, {
      signal: controller.signal,
    });
    await until('the command to start', () => existsSync(join(dir, 'started')));
    controller.abort();
    const result = await running;
    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(false);
  });

  test('a group that already ended when the timeout fires is not reported as a failed stop', async () => {
    const warn = spyOn(log, 'warn');
    try {
      const result = await runCommand(
        ['perl', '-e', 'if (fork() == 0) { setpgrp(0, 0); sleep 1; exit 0 } exit 0'],
        createTempDir(),
        { timeoutMs: 50 }
      );
      expect(result.timedOut).toBe(true);
      expect(warn.mock.calls.filter(([message]) => message === '[Shell] Could not stop a command')).toEqual(
        []
      );
    } finally {
      warn.mockRestore();
    }
  });

  test('a group that cannot be signalled is logged, the command still ends as timed out', async () => {
    const warn = spyOn(log, 'warn');
    const kill = spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('kill() failed: EPERM'), { code: 'EPERM' });
    });
    try {
      const result = await runCommand(['sh', '-c', 'sleep 0.3'], createTempDir(), { timeoutMs: 20 });
      expect(result.timedOut).toBe(true);
      expect(warn.mock.calls.map(([message]) => message)).toContain('[Shell] Could not stop a command');
    } finally {
      kill.mockRestore();
      warn.mockRestore();
    }
  });
});

describe('killProcessGroup', () => {
  test('a group left with only its exited leader is not reported as a failed stop', async () => {
    const parent = Bun.spawn(
      [
        'perl',
        '-e',
        '$| = 1; my $pid = fork(); if ($pid == 0) { setpgrp(0, 0); exit 0 } print "$pid\\n"; sleep 5',
      ],
      { stdout: 'pipe' }
    );
    const reader = parent.stdout.getReader();
    const pid = Number(new TextDecoder().decode((await reader.read()).value).trim());
    reader.releaseLock();
    await until('the leader to exit', () => readProcessState(pid).startsWith('Z'));
    const warn = spyOn(log, 'warn');
    try {
      killProcessGroup(pid);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      parent.kill();
      await parent.exited;
    }
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
