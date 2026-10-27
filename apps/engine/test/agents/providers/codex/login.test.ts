import { describe, expect, test } from 'bun:test';
import { parseLoginMethod, readCodexLogin } from '../../../../src/agents/providers/codex/login.ts';
import type { CodexRuntime } from '../../../../src/agents/providers/codex/session.ts';
import { FakeCodex } from '../../../helpers/codex.ts';

function runtimeWith(login: string) {
  return new FakeCodex({}, { FAKE_CODEX_LOGIN: login }).runtime;
}

const MISSING: CodexRuntime = {
  resolveExecutable: () =>
    Promise.resolve({ ok: false, reason: 'not_installed', message: 'No codex.', version: null }),
};

const OLD: CodexRuntime = {
  resolveExecutable: () =>
    Promise.resolve({
      ok: false,
      reason: 'outdated',
      message: 'Codex 0.1.0 is too old. Update it with `npm i`.',
      version: '0.1.0',
    }),
};

describe('the Codex sign-in', () => {
  test('reads how codex is signed in', async () => {
    expect(await readCodexLogin(runtimeWith('chatgpt'))).toEqual({
      provider: 'codex',
      label: 'Codex',
      status: 'signed_in',
      method: 'ChatGPT',
      version: '0.200.0',
      detail: 'Signed in with ChatGPT.',
      fix: null,
    });
    expect(await readCodexLogin(runtimeWith('api'))).toMatchObject({
      method: 'API key',
      detail: 'Signed in with API key.',
    });
    expect(parseLoginMethod('Logged in')).toBeNull();
  });

  test('says how to sign in, install or update', async () => {
    expect(await readCodexLogin(runtimeWith('signed_out'))).toMatchObject({
      status: 'signed_out',
      detail: 'Not logged in',
      fix: 'Run `codex login` in a terminal, then refresh.',
    });
    expect(await readCodexLogin(runtimeWith('old'))).toMatchObject({ status: 'outdated', fix: null });
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
