import type { ProviderLogin } from '@shinsa/core';
import { Effect } from 'effect';
import { CODEX_INSTALL } from '../executable/schema.ts';
import { parseLoginMethod } from './method.ts';
import { type CodexLoginDefinition, type LoginPatch, SIGN_IN, UNKNOWN_SYNTAX } from './schema.ts';

export const readLogin = Effect.fn('CodexLogin.read')(function* (definition: CodexLoginDefinition) {
  const createLogin = (patch: LoginPatch): ProviderLogin => ({
    provider: 'codex',
    label: 'Codex',
    method: null,
    version: null,
    detail: null,
    fix: null,
    ...patch,
  });
  const readFirstLine = (text: string) =>
    text
      .split('\n')
      .find((line) => line.trim())
      ?.trim() ?? '';

  const executable = yield* definition.executable;
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
  const result = yield* definition.status(executable.path);
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
    detail: readFirstLine(output) || 'Not signed in.',
    fix: SIGN_IN,
  });
});
