import { type Bytes, concatBytes, encodeText } from './bytes.ts';

const COUNTER_BYTES = 8;

const NONCE_BYTES = 12;

const FRAME_LABEL = encodeText('shinsa-remote-frame-v1');

export class FrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FrameError';
  }
}

function serializeCounter(counter: number): Bytes {
  const bytes = new Uint8Array(COUNTER_BYTES);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(counter));
  return bytes;
}

function resolveNonce(counter: Bytes): Bytes {
  const nonce = new Uint8Array(NONCE_BYTES);
  nonce.set(counter, NONCE_BYTES - COUNTER_BYTES);
  return nonce;
}

function createInOrder<T>(step: (input: Bytes) => Promise<T>) {
  let last: Promise<unknown> = Promise.resolve();
  return (input: Bytes): Promise<T> => {
    const result = last.then(
      () => step(input),
      () => step(input)
    );
    last = result;
    return result;
  };
}

export function createFrameSealer(key: CryptoKey) {
  let next = 0;
  return createInOrder(async (plain) => {
    const counter = serializeCounter(next);
    next += 1;
    const sealed = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: resolveNonce(counter), additionalData: FRAME_LABEL },
      key,
      plain
    );
    return concatBytes(counter, new Uint8Array(sealed));
  });
}

export function createFrameOpener(key: CryptoKey) {
  let next = 0;
  let broken = false;
  async function open(frame: Bytes): Promise<Bytes> {
    if (broken) throw new FrameError('The channel is closed after a bad frame.');
    broken = true;
    if (frame.length <= COUNTER_BYTES) throw new FrameError('A frame is too short.');
    const counter = frame.slice(0, COUNTER_BYTES);
    if (new DataView(counter.buffer).getBigUint64(0) !== BigInt(next))
      throw new FrameError('A frame arrived out of order.');
    try {
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: resolveNonce(counter), additionalData: FRAME_LABEL },
        key,
        frame.slice(COUNTER_BYTES)
      );
      next += 1;
      broken = false;
      return new Uint8Array(plain);
    } catch {
      throw new FrameError('A frame failed to open.');
    }
  }
  return createInOrder(open);
}
