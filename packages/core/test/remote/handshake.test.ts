import { describe, expect, test } from 'bun:test';
import { Effect, Option } from 'effect';
import { decodeText, encodeText, serializeBase64Url } from '../../src/remote/bytes.ts';
import { CHANNEL_COMPRESSION, createFrameOpener, createFrameSealer } from '../../src/remote/frames.ts';
import {
  createClientHello,
  createEnrollProof,
  DEVICE_NAME_LIMIT,
  deriveClientSession,
  deriveServerSession,
  type HandshakeKeys,
  parseClientHello,
  parseServerHello,
  REMOTE_PROTOCOL_VERSION,
  resolveCompression,
  type SessionKeys,
  verifyEnrollProof,
} from '../../src/remote/handshake.ts';
import { serializePublicKey } from '../../src/remote/keys.ts';
import { createKeyPair } from './helpers.ts';

async function createParties() {
  const machine = await createKeyPair();
  const device = await createKeyPair();
  const clientEphemeral = await createKeyPair();
  const serverEphemeral = await createKeyPair();
  const keys: HandshakeKeys = {
    machine: await Effect.runPromise(serializePublicKey(machine.publicKey)),
    device: await Effect.runPromise(serializePublicKey(device.publicKey)),
    clientEphemeral: await Effect.runPromise(serializePublicKey(clientEphemeral.publicKey)),
    serverEphemeral: await Effect.runPromise(serializePublicKey(serverEphemeral.publicKey)),
  };
  return { machine, device, clientEphemeral, serverEphemeral, keys };
}

async function sendOver(from: SessionKeys, to: SessionKeys, text: string) {
  const frame = await Effect.runPromise(createFrameSealer(from.send)(encodeText(text)));
  return decodeText(await Effect.runPromise(createFrameOpener(to.receive)(frame)));
}

describe('the handshake', () => {
  test('gives both sides matching keys in each direction', async () => {
    const parties = await createParties();
    const client = await Effect.runPromise(
      deriveClientSession({
        keys: parties.keys,
        machinePublicKey: parties.machine.publicKey,
        devicePrivateKey: parties.device.privateKey,
        clientEphemeralPrivateKey: parties.clientEphemeral.privateKey,
      })
    );
    const server = await Effect.runPromise(
      deriveServerSession({
        keys: parties.keys,
        machinePrivateKey: parties.machine.privateKey,
        serverEphemeralPrivateKey: parties.serverEphemeral.privateKey,
      })
    );
    expect(await sendOver(client, server, 'to the engine')).toBe('to the engine');
    expect(await sendOver(server, client, 'to the browser')).toBe('to the browser');
    await expect(sendOver(client, client, 'reflected')).rejects.toThrow('failed to open');
  });

  test('fails when the client pinned another machine key, so an impostor engine reads nothing', async () => {
    const parties = await createParties();
    const impostor = await createKeyPair();
    const client = await Effect.runPromise(
      deriveClientSession({
        keys: parties.keys,
        machinePublicKey: impostor.publicKey,
        devicePrivateKey: parties.device.privateKey,
        clientEphemeralPrivateKey: parties.clientEphemeral.privateKey,
      })
    );
    const server = await Effect.runPromise(
      deriveServerSession({
        keys: parties.keys,
        machinePrivateKey: parties.machine.privateKey,
        serverEphemeralPrivateKey: parties.serverEphemeral.privateKey,
      })
    );
    await expect(sendOver(client, server, 'secret')).rejects.toThrow('failed to open');
  });

  test('fails when the client does not hold the device key it named', async () => {
    const parties = await createParties();
    const stolen = await createKeyPair();
    const client = await Effect.runPromise(
      deriveClientSession({
        keys: parties.keys,
        machinePublicKey: parties.machine.publicKey,
        devicePrivateKey: stolen.privateKey,
        clientEphemeralPrivateKey: parties.clientEphemeral.privateKey,
      })
    );
    const server = await Effect.runPromise(
      deriveServerSession({
        keys: parties.keys,
        machinePrivateKey: parties.machine.privateKey,
        serverEphemeralPrivateKey: parties.serverEphemeral.privateKey,
      })
    );
    await expect(sendOver(client, server, 'secret')).rejects.toThrow('failed to open');
  });

  test('fails when a key in the transcript was swapped on the way', async () => {
    const parties = await createParties();
    const other = await createKeyPair();
    const client = await Effect.runPromise(
      deriveClientSession({
        keys: { ...parties.keys, machine: await Effect.runPromise(serializePublicKey(other.publicKey)) },
        machinePublicKey: parties.machine.publicKey,
        devicePrivateKey: parties.device.privateKey,
        clientEphemeralPrivateKey: parties.clientEphemeral.privateKey,
      })
    );
    const server = await Effect.runPromise(
      deriveServerSession({
        keys: parties.keys,
        machinePrivateKey: parties.machine.privateKey,
        serverEphemeralPrivateKey: parties.serverEphemeral.privateKey,
      })
    );
    await expect(sendOver(client, server, 'secret')).rejects.toThrow('failed to open');
  });

  test('refuses a handshake key that is not a public key', async () => {
    const parties = await createParties();
    await expect(
      Effect.runPromise(
        deriveServerSession({
          keys: { ...parties.keys, clientEphemeral: 'nope' },
          machinePrivateKey: parties.machine.privateKey,
          serverEphemeralPrivateKey: parties.serverEphemeral.privateKey,
        })
      )
    ).rejects.toThrow('not a P-256 public key');
  });
});

describe('the hello messages', () => {
  test('builds a client hello and reads it back', async () => {
    const parties = await createParties();
    const hello = await Effect.runPromise(
      createClientHello(parties.device.publicKey, parties.clientEphemeral.publicKey, null)
    );
    expect(hello).toEqual({
      type: 'hello',
      version: REMOTE_PROTOCOL_VERSION,
      device: parties.keys.device,
      ephemeral: parties.keys.clientEphemeral,
      enroll: null,
      name: null,
      compression: [],
    });
    expect(Option.getOrNull(parseClientHello(JSON.stringify(hello)))).toEqual(hello);
    expect(
      Option.getOrNull(parseClientHello(JSON.stringify({ ...hello, enroll: 'proof', extra: 1 })))
    ).toEqual({
      ...hello,
      enroll: 'proof',
    });
  });

  test('carries the name a device asks to be added under, trimmed to the limit', async () => {
    const parties = await createParties();
    const hello = await Effect.runPromise(
      createClientHello(parties.device.publicKey, parties.clientEphemeral.publicKey, 'proof', 'Bob iPhone')
    );
    expect(Option.getOrNull(parseClientHello(JSON.stringify(hello)))?.name).toBe('Bob iPhone');
    const long = { ...hello, name: ` ${'x'.repeat(DEVICE_NAME_LIMIT + 10)} ` };
    expect(Option.getOrNull(parseClientHello(JSON.stringify(long)))?.name).toHaveLength(DEVICE_NAME_LIMIT);
    expect(Option.getOrNull(parseClientHello(JSON.stringify({ ...hello, name: '  ' })))?.name).toBeNull();
    expect(Option.getOrNull(parseClientHello(JSON.stringify({ ...hello, name: 3 })))?.name).toBeNull();
  });

  test('offers compression and reads only the one it knows', async () => {
    const parties = await createParties();
    const hello = await Effect.runPromise(
      createClientHello(parties.device.publicKey, parties.clientEphemeral.publicKey, null, null, [
        CHANNEL_COMPRESSION,
      ])
    );
    const parsed = Option.getOrNull(parseClientHello(JSON.stringify(hello)));
    expect(parsed?.compression).toEqual([CHANNEL_COMPRESSION]);
    expect(parsed && Option.getOrNull(resolveCompression(parsed))).toBe(CHANNEL_COMPRESSION);
    const unknown = Option.getOrNull(parseClientHello(JSON.stringify({ ...hello, compression: ['zstd'] })));
    expect(unknown?.compression).toEqual([]);
    expect(unknown && Option.getOrNull(resolveCompression(unknown))).toBeNull();
    const older = Option.getOrNull(parseClientHello(JSON.stringify({ ...hello, compression: undefined })));
    expect(older && Option.getOrNull(resolveCompression(older))).toBeNull();
  });

  test('refuses a client hello of another shape or version', () => {
    const hello = {
      type: 'hello',
      version: REMOTE_PROTOCOL_VERSION,
      device: 'd',
      ephemeral: 'e',
      enroll: null,
    };
    expect(Option.getOrNull(parseClientHello('{'))).toBeNull();
    expect(Option.getOrNull(parseClientHello('[]'))).toBeNull();
    expect(Option.getOrNull(parseClientHello('null'))).toBeNull();
    expect(Option.getOrNull(parseClientHello(JSON.stringify({ ...hello, version: 2 })))).toBeNull();
    expect(Option.getOrNull(parseClientHello(JSON.stringify({ ...hello, device: 1 })))).toBeNull();
    expect(Option.getOrNull(parseClientHello(JSON.stringify({ ...hello, enroll: 1 })))).toBeNull();
  });

  test('reads a welcome or a refusal from the engine', () => {
    expect(Option.getOrNull(parseServerHello('{"type":"welcome","ephemeral":"e"}'))).toEqual({
      type: 'welcome',
      ephemeral: 'e',
      compression: null,
    });
    expect(
      Option.getOrNull(parseServerHello('{"type":"welcome","ephemeral":"e","compression":"deflate-raw"}'))
    ).toEqual({
      type: 'welcome',
      ephemeral: 'e',
      compression: CHANNEL_COMPRESSION,
    });
    expect(
      Option.getOrNull(parseServerHello('{"type":"welcome","ephemeral":"e","compression":"zstd"}'))
    ).toMatchObject({
      compression: null,
    });
    expect(Option.getOrNull(parseServerHello('{"type":"refused","reason":"r"}'))).toEqual({
      type: 'refused',
      reason: 'r',
    });
    expect(Option.getOrNull(parseServerHello('{"type":"pending"}'))).toEqual({ type: 'pending' });
    expect(Option.getOrNull(parseServerHello('{"type":"welcome"}'))).toBeNull();
    expect(Option.getOrNull(parseServerHello('{"type":"refused"}'))).toBeNull();
    expect(Option.getOrNull(parseServerHello('nope'))).toBeNull();
  });
});

describe('the enrollment proof', () => {
  const keys = { machine: 'm', device: 'd', clientEphemeral: 'e' };
  const secret = serializeBase64Url(new Uint8Array(32).fill(7));

  test('verifies with the same secret and keys', async () => {
    const proof = await Effect.runPromise(createEnrollProof(secret, keys));
    expect(await Effect.runPromise(verifyEnrollProof(secret, proof, keys))).toBe(true);
  });

  test('fails for another device key, ephemeral, machine or secret, so a seen proof cannot be reused', async () => {
    const proof = await Effect.runPromise(createEnrollProof(secret, keys));
    expect(await Effect.runPromise(verifyEnrollProof(secret, proof, { ...keys, device: 'x' }))).toBe(false);
    expect(await Effect.runPromise(verifyEnrollProof(secret, proof, { ...keys, clientEphemeral: 'x' }))).toBe(
      false
    );
    expect(await Effect.runPromise(verifyEnrollProof(secret, proof, { ...keys, machine: 'x' }))).toBe(false);
    const other = serializeBase64Url(new Uint8Array(32).fill(8));
    expect(await Effect.runPromise(verifyEnrollProof(other, proof, keys))).toBe(false);
  });

  test('refuses a broken secret or proof', async () => {
    await expect(Effect.runPromise(createEnrollProof('', keys))).rejects.toThrow('not valid');
    expect(await Effect.runPromise(verifyEnrollProof('!', 'proof', keys))).toBe(false);
    expect(await Effect.runPromise(verifyEnrollProof(secret, '!', keys))).toBe(false);
  });
});
