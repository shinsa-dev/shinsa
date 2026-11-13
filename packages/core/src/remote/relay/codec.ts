import { Option, Schema } from 'effect';
import type { Bytes } from '../bytes.ts';
import {
  RELAY_CHUNK_BYTES,
  RELAY_DATA_HEADER_BYTES,
  RELAY_DATA_KINDS,
  RELAY_MAX_MESSAGE_BYTES,
  RelayControl,
  type RelayData,
  type RelayDataKind,
  RelayStreamId,
} from './schema.ts';

const decodeControl = Schema.decodeUnknownOption(Schema.fromJsonString(RelayControl));

const decodeStreamId = Schema.decodeUnknownOption(RelayStreamId);

const KIND_BY_BYTE = new Map<number, RelayDataKind>(
  Object.entries(RELAY_DATA_KINDS).map(([kind, byte]) => [byte, kind as RelayDataKind])
);

export const RELAY_PING = serializeRelayControl({ type: 'ping' });

export const RELAY_PONG = serializeRelayControl({ type: 'pong' });

export function serializeRelayControl(frame: RelayControl) {
  return JSON.stringify(frame);
}

export function parseRelayControl(text: string): Option.Option<RelayControl> {
  return decodeControl(text);
}

export function serializeRelayData(frame: RelayData): Bytes {
  const bytes = new Uint8Array(RELAY_DATA_HEADER_BYTES + frame.payload.length);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, RELAY_DATA_KINDS[frame.kind]);
  view.setUint32(1, frame.stream);
  bytes.set(frame.payload, RELAY_DATA_HEADER_BYTES);
  return bytes;
}

export function parseRelayData(bytes: Bytes): Option.Option<RelayData> {
  if (bytes.length < RELAY_DATA_HEADER_BYTES || bytes.length > RELAY_MAX_MESSAGE_BYTES) return Option.none();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kind = KIND_BY_BYTE.get(view.getUint8(0));
  if (kind === undefined) return Option.none();
  return Option.map(decodeStreamId(view.getUint32(1)), (stream) => ({
    stream,
    kind,
    payload: bytes.subarray(RELAY_DATA_HEADER_BYTES),
  }));
}

export function listRelayBodyFrames(
  stream: RelayStreamId,
  body: Bytes,
  chunkBytes: number = RELAY_CHUNK_BYTES
) {
  const frames: Bytes[] = [];
  for (let offset = 0; offset < body.length; offset += chunkBytes)
    frames.push(
      serializeRelayData({ stream, kind: 'binary', payload: body.subarray(offset, offset + chunkBytes) })
    );
  return frames;
}
