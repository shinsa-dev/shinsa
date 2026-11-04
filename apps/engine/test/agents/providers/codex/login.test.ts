import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { parseLoginMethod } from '../../../../src/agents/providers/codex/login/method.ts';
import { readLogin } from '../../../../src/agents/providers/codex/login/service.ts';
import type { CodexRuntime } from '../../../../src/agents/providers/codex/session/schema.ts';
import type { CommandResult } from '../../../../src/shell/schema.ts';
import { FakeCodex } from '../../../helpers/codex.ts';
import { buildCodexProvider, runProvider } from '../../../helpers/providers.ts';

type LoginRunner = () => Promise<CommandResult>;

function readCodexLogin(runtime: CodexRuntime, run?: LoginRunner) {
  if (!run) return runProvider(buildCodexProvider(runtime).readLogin!);
  return Effect.runPromise(
    readLogin({ executable: runtime.resolveExecutable, status: () => Effect.promise(run) })
  );
}

const INSTALLED: CodexRuntime = {
  resolveExecutable: Effect.succeed({ ok: true, path: '/bin/codex', version: '0.200.0' }),
};

function answerWith(exit: number, stdout: string, stderr = ''): LoginRunner {
  return () => Promise.resolve({ ok: exit === 0, code: exit, stdout, stderr, timedOut: false });
}

const MISSING: CodexRuntime = {
  resolveExecutable: Effect.succeed({
    ok: false,
    reason: 'not_installed',
    message: 'No codex.',
    version: null,
  }),
};

const OLD: CodexRuntime = {
  resolveExecutable: Effect.succeed({
    ok: false,
    reason: 'outdated',
    message: 'Codex 0.1.0 is too old. Update it with `npm i`.',
    version: '0.1.0',
  }),
};

describe('the Codex sign-in', () => {
  test('reads how codex is signed in', async () => {
    expect(await readCodexLogin(new FakeCodex().runtime)).toEqual({
      provider: 'codex',
      label: 'Codex',
      status: 'signed_in',
      method: 'ChatGPT',
      version: '0.200.0',
      detail: 'Signed in with ChatGPT.',
      fix: null,
    });
    expect(
      await readCodexLogin(INSTALLED, answerWith(0, 'Logged in using an API key - sk-proj-***'))
    ).toMatchObject({
      method: 'API key',
      detail: 'Signed in with API key.',
    });
    expect(parseLoginMethod('Logged in')).toBeNull();
  });

  test('says how to sign in, install or update', async () => {
    expect(await readCodexLogin(INSTALLED, answerWith(1, '', 'Not logged in'))).toMatchObject({
      status: 'signed_out',
      detail: 'Not logged in',
      fix: 'Run `codex login` in a terminal, then refresh.',
    });
    expect(
      await readCodexLogin(INSTALLED, answerWith(2, '', "error: unrecognized subcommand 'login'"))
    ).toMatchObject({ status: 'outdated', fix: null });
    expect(await readCodexLogin(MISSING)).toMatchObject({
      status: 'not_installed',
      fix: 'Install it with `npm install -g @openai/codex`.',
    });
    expect(await readCodexLogin(OLD)).toMatchObject({
      status: 'outdated',
      version: '0.1.0',
      detail: expect.stringContaining('too old'),
    });
  });

  test('a status check that hangs or prints nothing still says something', async () => {
    const runtime = new FakeCodex().runtime;
    const timedOut = await readCodexLogin(runtime, () =>
      Promise.resolve({ ok: false, code: 1, stdout: '', stderr: '', timedOut: true })
    );
    expect(timedOut).toMatchObject({ status: 'unknown', detail: 'Codex did not answer in time.' });
    const silent = await readCodexLogin(runtime, () =>
      Promise.resolve({ ok: false, code: 1, stdout: '', stderr: '', timedOut: false })
    );
    expect(silent).toMatchObject({ status: 'signed_out', detail: 'Not signed in.' });
    const bare = await readCodexLogin(runtime, () =>
      Promise.resolve({ ok: true, code: 0, stdout: 'ok', stderr: '', timedOut: false })
    );
    expect(bare).toMatchObject({ status: 'signed_in', method: null, detail: 'Signed in.' });
  });
});
