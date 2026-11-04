import {
  type Bytes,
  type ChannelCompression,
  type ChannelMessage,
  createClientHello,
  createEnrollProof,
  createFrameOpener,
  createFrameSealer,
  decodeText,
  deriveClientSession,
  encodeText,
  parseChannelMessage,
  parsePublicKey,
  parseServerHello,
  REMOTE_KEY_ALGORITHM,
  serializeChannelMessage,
  serializePublicKey,
} from '@shinsa/core';
import { Effect } from 'effect';

export function createKeyPair() {
  return crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, ['deriveBits']) as Promise<CryptoKeyPair>;
}

export interface HandshakeStart {
  hello: string;
  finish: (welcome: string) => Promise<TestSession>;
}

export interface TestSession {
  seal: (message: ChannelMessage) => Promise<Bytes>;
  sealText: (text: string) => Promise<Bytes>;
  open: (frame: Bytes) => Promise<ChannelMessage | null>;
  compression: ChannelCompression | null;
}

export async function startHandshake(input: {
  machineKey: string;
  device: CryptoKeyPair;
  enrollSecret?: string;
  name?: string;
  compression?: ChannelCompression[];
}): Promise<HandshakeStart> {
  const ephemeral = await createKeyPair();
  const hello = await Effect.runPromise(
    createClientHello(
      input.device.publicKey,
      ephemeral.publicKey,
      null,
      input.name ?? null,
      input.compression ?? []
    )
  );
  if (input.enrollSecret) {
    hello.enroll = await Effect.runPromise(
      createEnrollProof(input.enrollSecret, {
        machine: input.machineKey,
        device: hello.device,
        clientEphemeral: hello.ephemeral,
      })
    );
  }
  return {
    hello: JSON.stringify(hello),
    finish: async (text) => {
      const welcome = parseServerHello(text);
      if (welcome?.type !== 'welcome') throw new Error(`Refused: ${text}`);
      const session = await Effect.runPromise(
        deriveClientSession({
          keys: {
            machine: input.machineKey,
            device: hello.device,
            clientEphemeral: hello.ephemeral,
            serverEphemeral: welcome.ephemeral,
          },
          machinePublicKey: (await Effect.runPromise(parsePublicKey(input.machineKey))) as CryptoKey,
          devicePrivateKey: input.device.privateKey,
          clientEphemeralPrivateKey: ephemeral.privateKey,
        })
      );
      const sealFrame = createFrameSealer(session.send, welcome.compression);
      const openFrame = createFrameOpener(session.receive, welcome.compression);
      return {
        compression: welcome.compression,
        seal: (message) => Effect.runPromise(sealFrame(encodeText(serializeChannelMessage(message)))),
        sealText: (plain) => Effect.runPromise(sealFrame(encodeText(plain))),
        open: async (frame) => parseChannelMessage(decodeText(await Effect.runPromise(openFrame(frame)))),
      };
    },
  };
}

export async function serializeDeviceKey(device: CryptoKeyPair) {
  return Effect.runPromise(serializePublicKey(device.publicKey));
}
