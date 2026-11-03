import { describe, expect, test } from 'bun:test';
import {
  CHANNEL_BODY_CHUNK_BYTES,
  createShareHello,
  deriveShareSessionKey,
  REMOTE_KEY_ALGORITHM,
  serializeBase64Url,
  serializePublicKey,
} from '@shinsa/core';
import { createChannelEphemeral, ShareChannel } from '../../src/remote/share-channel.ts';
import { captureLogs } from '../helpers/logs.ts';
import { createShareView } from '../helpers/state.ts';

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
    sent: [] as unknown[],
    send: (data: unknown) => {
      peer.sent.push(data);
    },
    close: (code: number, reason: string) => {
      peer.closed = { code, reason };
    },
  };
  return peer;
}

describe('a share channel that breaks', () => {
  test('closes when the hello cannot be answered, and logs why', async () => {
    const logs = captureLogs();
    const peer = createPeer();
    const channel = new ShareChannel(peer, {
      name: 'share link',
      authorize: () => Promise.reject(new Error('state is gone')),
      resolveLive: () => Promise.reject(new Error('unused')),
    });
    await channel.receive(await createHello());
    expect(peer.closed).toEqual({ code: 1008, reason: 'The share link broke.' });
    expect(logs.fieldsOf('[Share] Closing a live view')).toEqual([
      { reason: 'The share link broke.', error: 'state is gone' },
    ]);
    logs.restore();
  });

  test('closes when the task cannot be read for a push, and ignores what comes after', async () => {
    const logs = captureLogs();
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
    logs.restore();
  });

  test('closes without sending a view that breaks its allowlist', async () => {
    const logs = captureLogs();
    const peer = createPeer();
    const ephemeral = await createChannelEphemeral();
    const view = createShareView({ title: 'Leaky' });
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
      resolveLive: () =>
        Promise.resolve({
          view: {
            ...view,
            shared: { ...view.shared, task: { ...view.shared.task, worktreePath: '/wt/t1' } },
          },
          files: [],
        }),
    });
    await channel.receive(await createHello());
    expect(peer.closed).toEqual({ code: 1008, reason: 'The share link broke.' });
    expect(peer.sent).toHaveLength(1);
    logs.restore();
  });
});

describe('a share channel that stays open', () => {
  test('sends each file once per version in chunks, pushes nothing that did not change, and closes when told', async () => {
    const logs = captureLogs();
    try {
      const peer = createPeer();
      const ephemeral = await createChannelEphemeral();
      const reads: number[] = [];
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
        resolveLive: () =>
          Promise.resolve({
            view: createShareView({ title: 'Live' }),
            files: [
              {
                id: 'f1',
                version: '1',
                type: 'image/png',
                read: () => {
                  reads.push(1);
                  return Promise.resolve(new Uint8Array(CHANNEL_BODY_CHUNK_BYTES + 1));
                },
              },
            ],
          }),
      });
      await channel.receive(await createHello());
      expect(channel.subject).toBe('t1');
      expect(peer.sent).toHaveLength(6);
      await channel.push();
      expect(peer.sent).toHaveLength(6);
      expect(reads).toHaveLength(1);
      await channel.receive('again');
      expect(peer.closed).toEqual({ code: 1008, reason: 'A share link only listens.' });
      channel.close();
      channel.fail('Again.', new Error('ignored'));
      await channel.end('Done.');
      expect(peer.closed).toEqual({ code: 1008, reason: 'A share link only listens.' });
      expect(logs.fieldsOf('[Share] Closing a live view')).toEqual([]);
    } finally {
      logs.restore();
    }
  });
});
