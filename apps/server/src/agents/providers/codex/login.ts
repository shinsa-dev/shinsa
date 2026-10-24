import { tmpdir } from 'node:os';
import type { ProviderLogin } from '@shinsa/core';
import { STATUS_TIMEOUT_MS } from '../../../accounts/status.ts';
import { runCommand } from '../../../shell/index.ts';
import { CODEX_INSTALL } from './executable.ts';
import { CODEX_RUNTIME, type CodexRuntime } from './session.ts';

export type LoginRunner = typeof runCommand;

const SIGN_IN = 'Run `codex login` in a terminal, then refresh.';

const UNKNOWN_SYNTAX = /unrecognized subcommand|unexpected argument|unknown command/i;

function createLogin(patch: Partial<ProviderLogin> & Pick<ProviderLogin, 'status'>): ProviderLogin {
  return {
    provider: 'codex',
    label: 'Codex',
    method: null,
    version: null,
    detail: null,
    fix: null,
    ...patch,
  };
}

function firstLine(text: string) {
  return (
    text
      .split('\n')
      .find((line) => line.trim())
      ?.trim() ?? ''
  );
}

export function parseLoginMethod(output: string) {
  const method = /logged in (?:using|with|as)\s+(.+)/i.exec(output)?.[1]?.trim();
  if (!method) return null;
  return method.replace(/^an?\s+/i, '').replace(/\s+-\s+.*$/, '');
}

export async function readCodexLogin(
  runtime: CodexRuntime = CODEX_RUNTIME,
  run: LoginRunner = runCommand
): Promise<ProviderLogin> {
  const executable = await runtime.resolveExecutable();
  if (!executable.ok && executable.reason === 'not_installed') {
    return createLogin({
      status: 'not_installed',
      detail: 'Codex is not installed.',
      fix: `${CODEX_INSTALL}.`,
    });
  }
  if (!executable.ok) {
    return createLogin({
      status: 'outdated',
      version: executable.version,
      detail: executable.message,
      fix: null,
    });
  }
  const result = await run([executable.path, 'login', 'status'], tmpdir(), {
    timeoutMs: STATUS_TIMEOUT_MS,
    env: runtime.env,
  });
  const output = `${result.stdout}\n${result.stderr}`;
  const version = executable.version;
  if (result.ok) {
    const method = parseLoginMethod(output);
    return createLogin({
      status: 'signed_in',
      method,
      version,
      detail: method ? `Signed in with ${method}.` : 'Signed in.',
    });
  }
  if (UNKNOWN_SYNTAX.test(output)) {
    return createLogin({
      status: 'outdated',
      version,
      detail: 'This Codex cannot report its sign-in. Update it.',
      fix: null,
    });
  }
  if (result.timedOut)
    return createLogin({ status: 'unknown', version, detail: 'Codex did not answer in time.' });
  return createLogin({
    status: 'signed_out',
    version,
    detail: firstLine(output) || 'Not signed in.',
    fix: SIGN_IN,
  });
}
