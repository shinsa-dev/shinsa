import { describe, expect, it } from 'bun:test';
import type { ProviderLogin } from '@shinsa/core';
import {
  describeProviderLogin,
  describeProviderRefresh,
  resolveProviderHeader,
  selectSignInCommand,
} from '@/lib/accounts/providers.ts';
import { createWindow } from '../../support/accounts.ts';
import { NOW } from '../../support/state.ts';

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
  it('names how the provider is signed in', () => {
    expect(describeProviderLogin(login({ method: 'ChatGPT' }))).toEqual({
      title: 'Signed in with ChatGPT',
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
      fix: 'Run `codex login` in a terminal, then refresh.',
      command: 'codex login',
    });
    expect(
      describeProviderLogin(
        login({ status: 'not_installed', fix: 'Install it with `npm install -g @openai/codex`.' })
      )
    ).toMatchObject({ title: 'Not installed', command: 'npm install -g @openai/codex' });
    expect(
      describeProviderLogin(
        login({
          status: 'outdated',
          detail: 'Codex 0.1 is too old. Update it with `npm i -g @openai/codex@latest`.',
        })
      )
    ).toMatchObject({
      title: 'Too old for Shinsa',
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

describe('the sign-in command in a provider’s options', () => {
  it('offers the command that signs a signed-in provider in again, when Shinsa knows it', () => {
    expect(selectSignInCommand(login({}))).toBe('codex login');
    expect(selectSignInCommand(login({ status: 'signed_out' }))).toBeNull();
    expect(selectSignInCommand(login({ provider: 'other' }))).toBeNull();
  });
});

describe('a provider’s header in Agent usage', () => {
  it('reads like a Claude account’s: its name, its plan, what needs you and when its usage was read', () => {
    const usage = {
      status: 'ok' as const,
      windows: [createWindow({ id: 'w', usedPercent: 100, resetsAt: NOW + 60_000 })],
      detail: null,
      checkedAt: NOW - 60_000,
      source: 'read' as const,
    };
    expect(resolveProviderHeader(login({ email: 'me@example.com', plan: 'pro', usage }), NOW)).toEqual({
      name: { icon: 'IconOpenaiCodex', label: 'Codex · me@example.com' },
      detail: 'Pro',
      isDefault: false,
      status: { label: 'Out of usage', tone: 'red', until: NOW + 60_000 },
      checkedAt: NOW - 60_000,
      retryAt: null,
      reason: null,
    });
    expect(
      resolveProviderHeader(login({ status: 'signed_in', usage: { ...usage, retryAt: NOW + 60_000 } }), NOW)
        .retryAt
    ).toBe(NOW + 60_000);
  });

  it('falls back to its sign-in state without a plan, and has no freshness without a reading', () => {
    expect(resolveProviderHeader(login({ method: 'ChatGPT' }), NOW)).toMatchObject({
      name: { label: 'Codex' },
      detail: 'Signed in with ChatGPT',
      status: null,
      checkedAt: null,
    });
    expect(resolveProviderHeader(login({ status: 'signed_out', plan: 'pro' }), NOW)).toMatchObject({
      detail: 'Not signed in',
      status: { label: 'Needs sign-in', tone: 'orange', until: null },
    });
    expect(resolveProviderHeader(login({ status: 'outdated' }), NOW).status).toEqual({
      label: 'Update needed',
      tone: 'orange',
      until: null,
    });
  });
});
