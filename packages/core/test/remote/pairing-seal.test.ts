import { describe, expect, test } from 'bun:test';
import { Effect, Option } from 'effect';
import {
  type MachineCredentials,
  openPairingCredentials,
  PAIRING_SEAL_IV_BYTES,
  parseBase64Url,
  REMOTE_KEY_ALGORITHM,
  sealPairingCredentials,
  serializeBase64Url,
  serializePublicKey,
} from '../../src/index.ts';

const CREDENTIALS: MachineCredentials = {
  instanceId: 'studio000001',
  machineToken: 'machine-token',
  connectKey: 'connect-key',
};

async function createMachine() {
  const pair = (await crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, ['deriveBits'])) as CryptoKeyPair;
  return {
    publicKey: await Effect.runPromise(serializePublicKey(pair.publicKey)),
    privateKey: pair.privateKey,
  };
}

async function seal(machineKey: string, iv = crypto.getRandomValues(new Uint8Array(PAIRING_SEAL_IV_BYTES))) {
  const ephemeral = (await crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  return Effect.runPromise(sealPairingCredentials({ machineKey, ephemeral, iv }, CREDENTIALS));
}

describe('pairing seal', () => {
  test('only the machine whose key it was sealed to opens the credentials', async () => {
    const machine = await createMachine();
    const sealed = await seal(machine.publicKey);
    expect(sealed).not.toContain('machine-token');
    expect(await Effect.runPromise(openPairingCredentials(machine, sealed))).toEqual(CREDENTIALS);
    const other = await createMachine();
    expect(await Effect.runPromise(openPairingCredentials(other, sealed))).toBeNull();
    expect(
      await Effect.runPromise(openPairingCredentials({ ...machine, publicKey: other.publicKey }, sealed))
    ).toBeNull();
  });

  test('a changed, cut or malformed seal opens to nothing', async () => {
    const machine = await createMachine();
    const bytes = Option.getOrNull(parseBase64Url(await seal(machine.publicKey))) ?? new Uint8Array();
    const flipped = bytes.slice();
    flipped[flipped.length - 1] = (flipped.at(-1) ?? 0) ^ 1;
    const badPoint = bytes.slice();
    badPoint.fill(0, 1, 65);
    for (const sealed of [
      serializeBase64Url(flipped),
      serializeBase64Url(bytes.slice(0, 70)),
      serializeBase64Url(badPoint),
      '***',
    ])
      expect(await Effect.runPromise(openPairingCredentials(machine, sealed))).toBeNull();
  });

  test('opens to nothing when what is inside is not the credentials', async () => {
    const machine = await createMachine();
    const ephemeral = (await crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, [
      'deriveBits',
    ])) as CryptoKeyPair;
    const iv = crypto.getRandomValues(new Uint8Array(PAIRING_SEAL_IV_BYTES));
    const partial = { instanceId: 'studio000001' } as unknown as MachineCredentials;
    const sealed = await Effect.runPromise(
      sealPairingCredentials({ machineKey: machine.publicKey, ephemeral, iv }, partial)
    );
    expect(await Effect.runPromise(openPairingCredentials(machine, sealed))).toBeNull();
  });

  test('refuses a machine key that is not P-256, or an IV of the wrong size', async () => {
    const machine = await createMachine();
    await expect(seal('not-a-key')).rejects.toThrow('The machine key is not a P-256 public key.');
    await expect(seal(machine.publicKey, new Uint8Array(4))).rejects.toThrow(
      'A pairing seal takes a 12-byte IV.'
    );
  });
});
