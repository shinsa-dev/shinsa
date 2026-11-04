import { Effect, Semaphore } from 'effect';
import { type Bytes, concatBytes, encodeText } from './bytes.ts';
import { FrameError } from './schema.ts';

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

function createInOrder<A, E>(step: (input: Bytes) => Effect.Effect<A, E>) {
  const queue = Semaphore.makeUnsafe(1);
  return (input: Bytes) => queue.withPermit(step(input));
}

const readStream = Effect.fn('readStream')(function* (stream: ReadableStream<Uint8Array>, limit: number) {
  const chunks: Bytes[] = [];
  let size = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = yield* Effect.tryPromise({
      try: () => reader.read(),
      catch: () => new FrameError({ message: 'A frame failed to inflate.' }),
    });
    if (done) return concatBytes(...chunks);
    size += value.length;
    if (size > limit) {
      yield* Effect.promise(() => reader.cancel());
      return yield* new FrameError({ message: 'A frame inflates past the limit.' });
    }
    chunks.push(value as Bytes);
  }
});

function deflate(plain: Bytes) {
  const stream = new Blob([plain]).stream().pipeThrough(new CompressionStream(CHANNEL_COMPRESSION));
  return readStream(stream, Number.POSITIVE_INFINITY).pipe(Effect.orDie);
}

function inflate(deflated: Bytes, limit: number) {
  const stream = new Blob([deflated]).stream().pipeThrough(new DecompressionStream(CHANNEL_COMPRESSION));
  return readStream(stream, limit);
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

function selectDeflatedBody(packed: Bytes): Bytes | null {
  if (packed.length < 1 + DEFLATED_LENGTH_BYTES) return null;
  const length = new DataView(packed.buffer, packed.byteOffset).getUint32(1);
  const end = 1 + DEFLATED_LENGTH_BYTES + length;
  if (end > packed.length) return null;
  return packed.slice(1 + DEFLATED_LENGTH_BYTES, end);
}

const packFrame = Effect.fn('packFrame')(function* (plain: Bytes, compression: ChannelCompression | null) {
  if (!compression) return plain;
  if (plain.length >= COMPRESS_FROM_BYTES) {
    const packed = padDeflated(yield* deflate(plain));
    if (packed.length < plain.length) return packed;
  }
  return concatBytes(Uint8Array.of(PLAIN_HEADER) as Bytes, plain);
});

const unpackFrame = Effect.fn('unpackFrame')(function* (
  packed: Bytes,
  compression: ChannelCompression | null,
  limit: number
) {
  if (!compression) return packed;
  if (packed[0] === PLAIN_HEADER) return packed.slice(1);
  if (packed[0] !== DEFLATED_HEADER)
    return yield* new FrameError({ message: 'A frame has a header this side does not know.' });
  const body = selectDeflatedBody(packed);
  if (!body) return yield* new FrameError({ message: 'A frame failed to inflate.' });
  return yield* inflate(body, limit);
});

export function createFrameSealer(key: CryptoKey, compression: ChannelCompression | null = null) {
  let next = 0;
  return createInOrder(
    Effect.fn('sealFrame')(function* (plain: Bytes) {
      const packed = yield* packFrame(plain, compression);
      const counter = serializeCounter(next);
      next += 1;
      const sealed = yield* Effect.promise(() =>
        crypto.subtle.encrypt(
          { name: 'AES-GCM', iv: resolveNonce(counter), additionalData: FRAME_LABEL },
          key,
          packed
        )
      );
      return concatBytes(counter, new Uint8Array(sealed));
    })
  );
}

export function createFrameOpener(
  key: CryptoKey,
  compression: ChannelCompression | null = null,
  maxInflatedBytes = MAX_INFLATED_BYTES
) {
  let next = 0;
  let broken = false;
  return createInOrder(
    Effect.fn('openFrame')(function* (frame: Bytes) {
      if (broken) return yield* new FrameError({ message: 'The channel is closed after a bad frame.' });
      broken = true;
      if (frame.length <= COUNTER_BYTES) return yield* new FrameError({ message: 'A frame is too short.' });
      const counter = frame.slice(0, COUNTER_BYTES);
      if (new DataView(counter.buffer).getBigUint64(0) !== BigInt(next))
        return yield* new FrameError({ message: 'A frame arrived out of order.' });
      const packed: Bytes = new Uint8Array(
        yield* Effect.tryPromise({
          try: () =>
            crypto.subtle.decrypt(
              { name: 'AES-GCM', iv: resolveNonce(counter), additionalData: FRAME_LABEL },
              key,
              frame.slice(COUNTER_BYTES)
            ),
          catch: () => new FrameError({ message: 'A frame failed to open.' }),
        })
      );
      const plain = yield* unpackFrame(packed, compression, maxInflatedBytes);
      next += 1;
      broken = false;
      return plain;
    })
  );
}
