import { describe, expect, test } from 'bun:test';
import { decodeText, encodeText, serializeBase64Url } from '../../src/remote/bytes.ts';
import { createFrameOpener, createFrameSealer } from '../../src/remote/frames.ts';
import { REMOTE_PROTOCOL_VERSION } from '../../src/remote/handshake.ts';
import { serializePublicKey } from '../../src/remote/keys.ts';
import {
  createShareHello,
  createShareWelcome,
  deriveShareSessionKey,
  parseShareHello,
  parseShareMessage,
  parseShareWelcome,
  type ShareMessage,
  serializeShareMessage,
  verifyShareHello,
  verifyShareWelcome,
} from '../../src/remote/share-channel.ts';
import { createKeyPair } from './helpers.ts';

const KEY = serializeBase64Url(new Uint8Array(32).fill(3));

const OTHER_KEY = serializeBase64Url(new Uint8Array(32).fill(4));

describe('the share handshake', () => {
  test('both sides derive one key that opens what the machine seals, and only with the link key', async () => {
    const client = await createKeyPair();
    const server = await createKeyPair();
    const hello = await createShareHello('share-1', KEY, client.publicKey);
    expect(parseShareHello(JSON.stringify(hello))).toEqual(hello);
    expect(await verifyShareHello(KEY, hello)).toBe(true);
    expect(await verifyShareHello(OTHER_KEY, hello)).toBe(false);
    expect(await verifyShareHello(KEY, { ...hello, share: 'share-2' })).toBe(false);
    const keys = {
      share: 'share-1',
      clientEphemeral: hello.ephemeral,
      serverEphemeral: await serializePublicKey(server.publicKey),
    };
    const welcome = await createShareWelcome(KEY, keys);
    const parsed = parseShareWelcome(JSON.stringify(welcome));
    if (parsed?.type !== 'welcome') throw new Error('no welcome');
    expect(await verifyShareWelcome(KEY, keys, parsed.proof)).toBe(true);
    expect(await verifyShareWelcome(OTHER_KEY, keys, parsed.proof)).toBe(false);
    const sending = await deriveShareSessionKey(KEY, keys, server.privateKey, keys.clientEphemeral);
    const receiving = await deriveShareSessionKey(KEY, keys, client.privateKey, keys.serverEphemeral);
    const wrong = await deriveShareSessionKey(OTHER_KEY, keys, client.privateKey, keys.serverEphemeral);
    const frame = await createFrameSealer(sending)(encodeText('live'));
    expect(decodeText(await createFrameOpener(receiving)(frame))).toBe('live');
    await expect(createFrameOpener(wrong)(frame)).rejects.toThrow('A frame failed to open.');
  });

  test('refuses hellos and welcomes of the wrong shape, and keys that are not keys', async () => {
    const client = await createKeyPair();
    expect(parseShareHello('{')).toBeNull();
    expect(parseShareHello('[]')).toBeNull();
    expect(parseShareHello(JSON.stringify({ type: 'hello', version: REMOTE_PROTOCOL_VERSION }))).toBeNull();
    expect(
      parseShareHello(JSON.stringify({ type: 'share-hello', version: REMOTE_PROTOCOL_VERSION, share: 1 }))
    ).toBeNull();
    expect(parseShareWelcome(JSON.stringify({ type: 'refused', reason: 'Gone.' }))).toEqual({
      type: 'refused',
      reason: 'Gone.',
    });
    expect(parseShareWelcome(JSON.stringify({ type: 'welcome' }))).toBeNull();
    const hello = await createShareHello('s', KEY, client.publicKey);
    expect(await verifyShareHello('!', hello)).toBe(false);
    expect(await verifyShareHello(KEY, { ...hello, proof: '!' })).toBe(false);
    await expect(createShareHello('s', '', client.publicKey)).rejects.toThrow(
      'The channel key is not valid.'
    );
    const keys = { share: 's', clientEphemeral: 'x', serverEphemeral: 'y' };
    await expect(deriveShareSessionKey(KEY, keys, client.privateKey, 'x')).rejects.toThrow(
      'A channel handshake key is not valid.'
    );
  });
});

describe('the share messages', () => {
  test('round-trip, and anything else is refused', () => {
    const messages: ShareMessage[] = [
      { t: 'view', data: '{}' },
      { t: 'file', id: 'e1', version: 'v1', type: 'image/png' },
      { t: 'body', id: 'e1', chunk: 'AAAA' },
      { t: 'end', id: 'e1' },
      { t: 'closed', reason: 'This task is no longer shared.' },
    ];
    for (const message of messages)
      expect(parseShareMessage(serializeShareMessage(message))).toEqual(message);
    expect(parseShareMessage('nope')).toBeNull();
    expect(parseShareMessage(JSON.stringify({ t: 'request', id: '1' }))).toBeNull();
    expect(
      parseShareMessage(JSON.stringify({ t: 'file', id: 'e1', version: 'v', type: 'text/html' }))
    ).toBeNull();
    expect(parseShareMessage(JSON.stringify({ t: 'file', id: 'e1' }))).toBeNull();
    expect(parseShareMessage(JSON.stringify({ t: 'view' }))).toBeNull();
    expect(parseShareMessage(JSON.stringify({ t: 'body', id: 'e1' }))).toBeNull();
    expect(parseShareMessage(JSON.stringify({ t: 'end' }))).toBeNull();
    expect(parseShareMessage(JSON.stringify({ t: 'closed' }))).toBeNull();
  });
});
