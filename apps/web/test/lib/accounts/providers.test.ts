import { describe, expect, it } from 'bun:test';
import type { ProviderLogin } from '@shinsa/core';
import { describeProviderLogin, describeProviderRefresh } from '@/lib/accounts/providers.ts';

function login(overrides: Partial<ProviderLogin>): ProviderLogin {
  return {
    provider: 'codex',
    label: 'Codex',
    status: 'signed_in',
    method: null,
    version: '0.153.4',
    detail: null,
    fix: null,
    ...overrides,
  };
}

describe('describeProviderLogin', () => {
  it('names how the provider is signed in, and only flags what needs you', () => {
    expect(describeProviderLogin(login({ method: 'ChatGPT' }))).toEqual({
      title: 'Signed in with ChatGPT',
      status: null,
      fix: null,
      command: null,
    });
    expect(describeProviderLogin(login({})).title).toBe('Signed in');
    expect(describeProviderLogin(login({ status: 'unknown' })).title).toBe('Could not check the sign-in');
  });

  it('gives the command that fixes a signed-out, missing or old provider', () => {
    expect(
      describeProviderLogin(
        login({ status: 'signed_out', fix: 'Run `codex login` in a terminal, then refresh.' })
      )
    ).toEqual({
      title: 'Not signed in',
      status: { label: 'Needs sign-in', tone: 'orange' },
      fix: 'Run `codex login` in a terminal, then refresh.',
      command: 'codex login',
    });
    expect(
      describeProviderLogin(
        login({ status: 'not_installed', fix: 'Install it with `npm install -g @openai/codex`.' })
      )
    ).toMatchObject({ title: 'Not installed', status: null, command: 'npm install -g @openai/codex' });
    expect(
      describeProviderLogin(
        login({
          status: 'outdated',
          detail: 'Codex 0.1 is too old. Update it with `npm i -g @openai/codex@latest`.',
        })
      )
    ).toMatchObject({
      title: 'Too old for Shinsa',
      status: { label: 'Update needed', tone: 'orange' },
      command: 'npm i -g @openai/codex@latest',
    });
    expect(describeProviderLogin(login({ status: 'outdated', detail: null }))).toMatchObject({
      fix: null,
      command: null,
    });
    expect(
      describeProviderLogin(login({ status: 'signed_out', fix: 'Sign in somehow.' })).command
    ).toBeNull();
  });

  it('names its refresh for the provider', () => {
    expect(describeProviderRefresh(login({}))).toBe('Check the Codex sign-in again');
  });
});
