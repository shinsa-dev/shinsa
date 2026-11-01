import { describe, expect, test } from 'bun:test';
import { decodeText, encodeText } from '../../src/remote/bytes.ts';
import {
  CHANNEL_COMPRESSION,
  createFrameOpener,
  createFrameSealer,
  FrameError,
} from '../../src/remote/frames.ts';
import { createAesKey } from './helpers.ts';

describe('sealed frames', () => {
  test('open in order, and seal in call order even when called at once', async () => {
    const key = await createAesKey();
    const seal = createFrameSealer(key);
    const open = createFrameOpener(key);
    const frames = await Promise.all(['one', 'two', 'three'].map((text) => seal(encodeText(text))));
    const texts = await Promise.all(frames.map(async (frame) => decodeText(await open(frame))));
    expect(texts).toEqual(['one', 'two', 'three']);
  });

  test('never show the plain text and never repeat a nonce', async () => {
    const seal = createFrameSealer(await createAesKey());
    const first = await seal(encodeText('same'));
    const second = await seal(encodeText('same'));
    expect([...first.slice(8, 12)]).not.toEqual([...encodeText('same')]);
    expect([...first.slice(0, 8)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect([...second.slice(0, 8)]).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(first.slice(8)).not.toEqual(second.slice(8));
  });

  test('refuse a replayed or skipped frame and stay closed after it', async () => {
    const key = await createAesKey();
    const seal = createFrameSealer(key);
    const open = createFrameOpener(key);
    const first = await seal(encodeText('one'));
    const second = await seal(encodeText('two'));
    await open(first);
    await expect(open(first)).rejects.toThrow('out of order');
    await expect(open(second)).rejects.toThrow('closed after a bad frame');
  });

  test('refuse a frame that is too short, tampered with, or sealed with another key', async () => {
    const key = await createAesKey();
    const frame = await createFrameSealer(key)(encodeText('payload'));
    await expect(createFrameOpener(key)(new Uint8Array(8))).rejects.toBeInstanceOf(FrameError);
    const tampered = frame.slice();
    tampered[tampered.length - 1] = (tampered.at(-1) ?? 0) ^ 1;
    await expect(createFrameOpener(key)(tampered)).rejects.toThrow('failed to open');
    await expect(createFrameOpener(await createAesKey())(frame)).rejects.toThrow('failed to open');
  });
});

describe('compressed frames', () => {
  const large = JSON.stringify({
    tasks: Array.from({ length: 2000 }, (_, index) => ({ id: index, title: 'A task' })),
  });

  test('deflate a large plaintext before sealing and inflate it after opening', async () => {
    const key = await createAesKey();
    const plainFrame = await createFrameSealer(key)(encodeText(large));
    const frame = await createFrameSealer(key, CHANNEL_COMPRESSION)(encodeText(large));
    expect(frame.length).toBeLessThan(plainFrame.length / 4);
    expect(decodeText(await createFrameOpener(key, CHANNEL_COMPRESSION)(frame))).toBe(large);
  });

  test('keep a small or incompressible plaintext as it is, behind the plain header', async () => {
    const key = await createAesKey();
    const random = crypto.getRandomValues(new Uint8Array(32 * 1024));
    const seal = createFrameSealer(key, CHANNEL_COMPRESSION);
    const open = createFrameOpener(key, CHANNEL_COMPRESSION);
    const small = await seal(encodeText('small'));
    const noise = await seal(random);
    expect(decodeText(await open(small))).toBe('small');
    expect(await open(noise)).toEqual(random);
    const plainOpen = createFrameOpener(key);
    expect([...(await plainOpen(small))]).toEqual([0, ...encodeText('small')]);
  });

  test('keep sealing in call order while a large frame compresses', async () => {
    const key = await createAesKey();
    const seal = createFrameSealer(key, CHANNEL_COMPRESSION);
    const open = createFrameOpener(key, CHANNEL_COMPRESSION);
    const frames = await Promise.all([large, 'after'].map((text) => seal(encodeText(text))));
    const texts: string[] = [];
    for (const frame of frames) texts.push(decodeText(await open(frame)));
    expect(texts).toEqual([large, 'after']);
  });

  test('refuse an unknown header or a body that does not inflate, and stay closed after it', async () => {
    const key = await createAesKey();
    const seal = createFrameSealer(key);
    const unknown = await seal(Uint8Array.of(7, 1, 2));
    const broken = await seal(Uint8Array.of(1, 255, 255, 255));
    await expect(createFrameOpener(key, CHANNEL_COMPRESSION)(unknown)).rejects.toThrow('header');
    const open = createFrameOpener(key, CHANNEL_COMPRESSION);
    await expect(open(unknown)).rejects.toThrow('header');
    await expect(open(broken)).rejects.toThrow('closed after a bad frame');
    const second = createFrameOpener(key, CHANNEL_COMPRESSION);
    await second(await createFrameSealer(key)(Uint8Array.of(0)));
    await expect(second(broken)).rejects.toThrow('failed to inflate');
  });

  test('refuse a frame that inflates past the limit', async () => {
    const key = await createAesKey();
    const frame = await createFrameSealer(key, CHANNEL_COMPRESSION)(encodeText(large));
    await expect(createFrameOpener(key, CHANNEL_COMPRESSION, 1024)(frame)).rejects.toThrow('past the limit');
  });
});
