import { type Bytes, concatBytes, encodeText } from './bytes.ts';

const COUNTER_BYTES = 8;

const NONCE_BYTES = 12;

const FRAME_LABEL = encodeText('shinsa-remote-frame-v1');

export const CHANNEL_COMPRESSION = 'deflate-raw';

export type ChannelCompression = typeof CHANNEL_COMPRESSION;

const COMPRESS_FROM_BYTES = 16 * 1024;

const MAX_INFLATED_BYTES = 256 * 1024 * 1024;

const PLAIN_HEADER = 0;

const DEFLATED_HEADER = 1;

const DEFLATED_LENGTH_BYTES = 4;

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

async function readStream(stream: ReadableStream<Uint8Array>, limit: number): Promise<Bytes> {
  const chunks: Bytes[] = [];
  let size = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return concatBytes(...chunks);
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new FrameError('A frame inflates past the limit.');
    }
    chunks.push(value as Bytes);
  }
}

function deflate(plain: Bytes) {
  const stream = new Blob([plain]).stream().pipeThrough(new CompressionStream(CHANNEL_COMPRESSION));
  return readStream(stream, Number.POSITIVE_INFINITY);
}

async function inflate(deflated: Bytes, limit: number) {
  const stream = new Blob([deflated]).stream().pipeThrough(new DecompressionStream(CHANNEL_COMPRESSION));
  try {
    return await readStream(stream, limit);
  } catch (error) {
    if (error instanceof FrameError) throw error;
    throw new FrameError('A frame failed to inflate.');
  }
}

export function resolvePaddedLength(length: number) {
  if (length < 2) return length;
  const exponent = 31 - Math.clz32(length);
  const step = 2 ** (exponent - (32 - Math.clz32(exponent)));
  return Math.ceil(length / step) * step;
}

function padDeflated(deflated: Bytes): Bytes {
  const unpadded = 1 + DEFLATED_LENGTH_BYTES + deflated.length;
  const packed = new Uint8Array(resolvePaddedLength(unpadded));
  packed[0] = DEFLATED_HEADER;
  new DataView(packed.buffer).setUint32(1, deflated.length);
  packed.set(deflated, 1 + DEFLATED_LENGTH_BYTES);
  return packed as Bytes;
}

function resolveDeflatedBody(packed: Bytes): Bytes {
  if (packed.length < 1 + DEFLATED_LENGTH_BYTES) throw new FrameError('A frame failed to inflate.');
  const length = new DataView(packed.buffer, packed.byteOffset).getUint32(1);
  const end = 1 + DEFLATED_LENGTH_BYTES + length;
  if (end > packed.length) throw new FrameError('A frame failed to inflate.');
  return packed.slice(1 + DEFLATED_LENGTH_BYTES, end);
}

async function packFrame(plain: Bytes, compression: ChannelCompression | null): Promise<Bytes> {
  if (!compression) return plain;
  if (plain.length >= COMPRESS_FROM_BYTES) {
    const packed = padDeflated(await deflate(plain));
    if (packed.length < plain.length) return packed;
  }
  return concatBytes(Uint8Array.of(PLAIN_HEADER) as Bytes, plain);
}

function unpackFrame(packed: Bytes, compression: ChannelCompression | null, limit: number): Promise<Bytes> {
  if (!compression) return Promise.resolve(packed);
  if (packed[0] === PLAIN_HEADER) return Promise.resolve(packed.slice(1));
  if (packed[0] === DEFLATED_HEADER) return inflate(resolveDeflatedBody(packed), limit);
  return Promise.reject(new FrameError('A frame has a header this side does not know.'));
}

export function createFrameSealer(key: CryptoKey, compression: ChannelCompression | null = null) {
  let next = 0;
  return createInOrder(async (plain) => {
    const packed = await packFrame(plain, compression);
    const counter = serializeCounter(next);
    next += 1;
    const sealed = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: resolveNonce(counter), additionalData: FRAME_LABEL },
      key,
      packed
    );
    return concatBytes(counter, new Uint8Array(sealed));
  });
}

export function createFrameOpener(
  key: CryptoKey,
  compression: ChannelCompression | null = null,
  maxInflatedBytes = MAX_INFLATED_BYTES
) {
  let next = 0;
  let broken = false;
  async function open(frame: Bytes): Promise<Bytes> {
    if (broken) throw new FrameError('The channel is closed after a bad frame.');
    broken = true;
    if (frame.length <= COUNTER_BYTES) throw new FrameError('A frame is too short.');
    const counter = frame.slice(0, COUNTER_BYTES);
    if (new DataView(counter.buffer).getBigUint64(0) !== BigInt(next))
      throw new FrameError('A frame arrived out of order.');
    let packed: Bytes;
    try {
      packed = new Uint8Array(
        await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: resolveNonce(counter), additionalData: FRAME_LABEL },
          key,
          frame.slice(COUNTER_BYTES)
        )
      );
    } catch {
      throw new FrameError('A frame failed to open.');
    }
    const plain = await unpackFrame(packed, compression, maxInflatedBytes);
    next += 1;
    broken = false;
    return plain;
  }
  return createInOrder(open);
}
