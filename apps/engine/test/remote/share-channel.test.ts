import { describe, expect, spyOn, test } from 'bun:test';
import {
  createShareHello,
  deriveShareSessionKey,
  REMOTE_KEY_ALGORITHM,
  serializeBase64Url,
  serializePublicKey,
} from '@shinsa/core';
import { log } from '../../src/log/index.ts';
import { createChannelEphemeral, ShareChannel } from '../../src/remote/share-channel.ts';

const KEY = serializeBase64Url(new Uint8Array(32).fill(5));

async function createHello() {
  const ephemeral = (await crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  return JSON.stringify(await createShareHello('s1', KEY, ephemeral.publicKey));
}

function createPeer() {
  const peer = {
    closed: null as { code: number; reason: string } | null,
    send: () => undefined,
    close: (code: number, reason: string) => {
      peer.closed = { code, reason };
    },
  };
  return peer;
}

describe('a share channel that breaks', () => {
  test('closes when the hello cannot be answered, and logs why', async () => {
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    const peer = createPeer();
    const channel = new ShareChannel(peer, {
      name: 'share link',
      authorize: () => Promise.reject(new Error('state is gone')),
      resolveLive: () => Promise.reject(new Error('unused')),
    });
    await channel.receive(await createHello());
    expect(peer.closed).toEqual({ code: 1008, reason: 'The share link broke.' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test('closes when the task cannot be read for a push, and ignores what comes after', async () => {
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    const peer = createPeer();
    const ephemeral = await createChannelEphemeral();
    const channel = new ShareChannel(peer, {
      name: 'share link',
      authorize: async () => ({
        subject: 't1',
        session: await deriveShareSessionKey(
          KEY,
          { share: 's1', clientEphemeral: 'c', serverEphemeral: 's' },
          ephemeral.privateKey,
          await serializePublicKey(ephemeral.publicKey)
        ),
        welcome: { type: 'welcome', ephemeral: 's', proof: 'p' },
      }),
      resolveLive: () => Promise.reject(new Error('no such task')),
    });
    await channel.receive(await createHello());
    expect(peer.closed).toEqual({ code: 1008, reason: 'The share link broke.' });
    expect(channel.subject).toBeNull();
    await channel.receive('anything');
    await channel.end('Gone.');
    warn.mockRestore();
  });
});
