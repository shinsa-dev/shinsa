import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { declineSecret, resolveSecretLabel, saveSecret } from '@/lib/secrets.ts';
import { spyOnToasts } from '../support/commands.ts';
import { startFakeOnboarding } from '../support/onboarding.ts';
import { createGate } from '../support/state.ts';

let toasts: ReturnType<typeof spyOnToasts>;

beforeEach(() => {
  toasts = spyOnToasts();
});

afterEach(() => {
  toasts.restore();
});

describe('answering a secret request', () => {
  it('posts the value to the secret store, never as a command', async () => {
    const fake = startFakeOnboarding({ 'POST /api/secrets/g%201': { answer: { ok: true } } });
    expect(await saveSecret('g 1', 'hunter2')).toBe(true);
    expect(await declineSecret('g 1')).toBe(true);
    expect(fake.requests.map((request) => [request.method, request.path, request.body])).toEqual([
      ['POST', '/api/secrets/g%201', { value: 'hunter2' }],
      ['POST', '/api/secrets/g%201', { decline: true }],
    ]);
    expect(toasts.success.mock.calls.map(([message]) => message)).toEqual([
      'Saved. The agent carries on.',
      'Declined. The agent carries on without it.',
    ]);
    fake.stop();
  });

  it('says what went wrong', async () => {
    const fake = startFakeOnboarding({
      'POST /api/secrets/g-1': {
        answer: { error: { message: 'This has already been answered.' } },
        status: 400,
      },
    });
    expect(await saveSecret('g-1', 'x')).toBe(false);
    expect(toasts.error).toHaveBeenCalledWith('This has already been answered.');
    fake.stop();
  });

  it('names what the agent asked for, or a secret when it gave no name', () => {
    expect(resolveSecretLabel(createGate({ id: 'g', taskId: 't', secret: { label: 'GitHub token' } }))).toBe(
      'GitHub token'
    );
    expect(resolveSecretLabel(createGate({ id: 'g', taskId: 't' }))).toBe('secret');
  });
});
