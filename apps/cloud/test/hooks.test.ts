import { describe, expect, test } from 'bun:test';
import {
  type PairPollResponse,
  type PairStartResponse,
  REMOTE_KEY_ALGORITHM,
  REMOTE_PATHS,
  resolvePairApprovePath,
  serializePublicKey,
} from '@shinsa/core';
import { HOOK_BODY_LIMIT_BYTES } from '../src/hooks.ts';
import { createHarness, type Harness, readJson } from './harness.ts';

async function pairInstance(harness: Harness) {
  const session = await harness.signIn();
  const pair = (await crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, ['deriveBits'])) as CryptoKeyPair;
  const start = await readJson<PairStartResponse>(
    await harness.post(REMOTE_PATHS.pairStart, {
      name: 'Studio',
      publicKey: await serializePublicKey(pair.publicKey),
      version: '1',
    })
  );
  await harness.post(resolvePairApprovePath(start.claimCode), {}, { session });
  const claimed = await readJson<PairPollResponse>(
    await harness.post(REMOTE_PATHS.pairPoll, { claimCode: start.claimCode, pollSecret: start.pollSecret })
  );
  if (claimed.status !== 'claimed') throw new Error('Pairing was not claimed.');
  return claimed.credentials.instanceId;
}

function answerTunnel(harness: Harness, answer: () => Response | Promise<Response>) {
  harness.handlers.push((call) =>
    call.url.includes('.shinsa.dev/api/hooks/') ? answer() : new Response('', { status: 599 })
  );
}

describe('webhooks through app.shinsa.dev', () => {
  test('forwards the delivery to the machine’s tunnel as it came, without cookies or Cloudflare headers', async () => {
    const harness = createHarness();
    const instanceId = await pairInstance(harness);
    answerTunnel(harness, () => Response.json({ delivery: 'd1' }, { status: 202 }));
    const delivered = await harness.call(`/hooks/${instanceId}/schedule-1/token-1?source=maple`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-maple-signature': 'sig',
        cookie: '__Host-shinsa_session=secret',
        'cf-connecting-ip': '1.2.3.4',
      },
      body: '{"alert":"down"}',
    });
    expect(delivered.status).toBe(202);
    expect(await delivered.json()).toEqual({ delivery: 'd1' });
    const forwarded = harness.calls.at(-1);
    expect(forwarded?.url).toBe(
      `https://t-${instanceId}.shinsa.dev/api/hooks/schedule-1/token-1?source=maple`
    );
    expect(forwarded?.method).toBe('POST');
    expect(forwarded?.body).toBe('{"alert":"down"}');
    expect(forwarded?.headers.get('x-maple-signature')).toBe('sig');
    expect(forwarded?.headers.get('cookie')).toBeNull();
    expect(forwarded?.headers.get('cf-connecting-ip')).toBeNull();
  });

  test('passes a GET through without a body', async () => {
    const harness = createHarness();
    const instanceId = await pairInstance(harness);
    answerTunnel(harness, () => new Response('ok'));
    const delivered = await harness.call(`/hooks/${instanceId}/schedule-1/token-1`);
    expect(delivered.status).toBe(200);
    expect(delivered.headers.get('content-type')).toBe('text/plain');
    expect(harness.calls.at(-1)?.body).toBe('');
  });

  test('answers 503 with a retry when the machine is offline', async () => {
    const harness = createHarness();
    const instanceId = await pairInstance(harness);
    answerTunnel(harness, () => new Response('Argo Tunnel error', { status: 530 }));
    const offline = await harness.call(`/hooks/${instanceId}/s/t`, { method: 'POST', body: 'x' });
    expect(offline.status).toBe(503);
    expect(offline.headers.get('retry-after')).toBe('60');
    harness.handlers.length = 0;
    answerTunnel(harness, () => Promise.reject(new Error('network')));
    expect((await harness.call(`/hooks/${instanceId}/s/t`, { method: 'POST', body: 'x' })).status).toBe(503);
  });

  test('refuses an unknown machine or a body over 1 MB', async () => {
    const harness = createHarness();
    expect((await harness.call('/hooks/nobody/s/t', { method: 'POST', body: 'x' })).status).toBe(404);
    const instanceId = await pairInstance(harness);
    const big = await harness.call(`/hooks/${instanceId}/s/t`, {
      method: 'POST',
      body: new Uint8Array(HOOK_BODY_LIMIT_BYTES + 1),
    });
    expect(big.status).toBe(413);
  });
});
