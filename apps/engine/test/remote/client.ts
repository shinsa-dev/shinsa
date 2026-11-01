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
  const hello = await createClientHello(
    input.device.publicKey,
    ephemeral.publicKey,
    null,
    input.name ?? null,
    input.compression ?? []
  );
  if (input.enrollSecret) {
    hello.enroll = await createEnrollProof(input.enrollSecret, {
      machine: input.machineKey,
      device: hello.device,
      clientEphemeral: hello.ephemeral,
    });
  }
  return {
    hello: JSON.stringify(hello),
    finish: async (text) => {
      const welcome = parseServerHello(text);
      if (welcome?.type !== 'welcome') throw new Error(`Refused: ${text}`);
      const session = await deriveClientSession({
        keys: {
          machine: input.machineKey,
          device: hello.device,
          clientEphemeral: hello.ephemeral,
          serverEphemeral: welcome.ephemeral,
        },
        machinePublicKey: (await parsePublicKey(input.machineKey)) as CryptoKey,
        devicePrivateKey: input.device.privateKey,
        clientEphemeralPrivateKey: ephemeral.privateKey,
      });
      const sealFrame = createFrameSealer(session.send, welcome.compression);
      const openFrame = createFrameOpener(session.receive, welcome.compression);
      return {
        compression: welcome.compression,
        seal: (message) => sealFrame(encodeText(serializeChannelMessage(message))),
        sealText: (plain) => sealFrame(encodeText(plain)),
        open: async (frame) => parseChannelMessage(decodeText(await openFrame(frame))),
      };
    },
  };
}

export async function serializeDeviceKey(device: CryptoKeyPair) {
  return serializePublicKey(device.publicKey);
}
