import { describe, expect, test } from 'bun:test';
import { type Bytes, decodeText, encodeText } from '../../src/remote/bytes.ts';
import {
  CHANNEL_COMPRESSION,
  createFrameOpener,
  createFrameSealer,
  FrameError,
  resolvePaddedLength,
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
    const broken = await seal(Uint8Array.of(1, 0, 0, 0, 3, 255, 255, 255));
    await expect(createFrameOpener(key, CHANNEL_COMPRESSION)(unknown)).rejects.toThrow('header');
    const open = createFrameOpener(key, CHANNEL_COMPRESSION);
    await expect(open(unknown)).rejects.toThrow('header');
    await expect(open(broken)).rejects.toThrow('closed after a bad frame');
    const second = createFrameOpener(key, CHANNEL_COMPRESSION);
    await second(await createFrameSealer(key)(Uint8Array.of(0)));
    await expect(second(broken)).rejects.toThrow('failed to inflate');
  });

  test('pad a deflated frame so its length hides small differences in its content', async () => {
    const key = await createAesKey();
    const seal = createFrameSealer(key, CHANNEL_COMPRESSION);
    const open = createFrameOpener(key, CHANNEL_COMPRESSION);
    const guesses = ['secret=aaaa', 'secret=abcd', 'secret=zq9x'].map((guess) => `${large}${guess}`);
    const frames: Bytes[] = [];
    for (const guess of guesses) frames.push(await seal(encodeText(guess)));
    expect(new Set(frames.map((frame) => frame.length)).size).toBe(1);
    const texts: string[] = [];
    for (const frame of frames) texts.push(decodeText(await open(frame)));
    expect(texts).toEqual(guesses);
  });

  test('round a length up to a bucket that widens with the length', () => {
    expect(resolvePaddedLength(0)).toBe(0);
    expect(resolvePaddedLength(1)).toBe(1);
    expect(resolvePaddedLength(9)).toBe(10);
    expect(resolvePaddedLength(16 * 1024 + 1)).toBe(17 * 1024);
    expect(resolvePaddedLength(4_000_000)).toBe(4_063_232);
    for (const length of [100, 5000, 70_000, 3_000_000, 200_000_000]) {
      const padded = resolvePaddedLength(length);
      expect(padded).toBeGreaterThanOrEqual(length);
      expect(padded / length).toBeLessThan(1.12);
    }
  });

  test('refuse a deflated frame too short for its length or whose length runs past its body', async () => {
    const key = await createAesKey();
    const seal = createFrameSealer(key);
    const short = await seal(Uint8Array.of(1, 0, 0));
    const overrun = await seal(Uint8Array.of(1, 0, 0, 0, 9, 1, 2));
    await expect(createFrameOpener(key, CHANNEL_COMPRESSION)(short)).rejects.toThrow('failed to inflate');
    const open = createFrameOpener(key, CHANNEL_COMPRESSION);
    await open(await createFrameSealer(key)(Uint8Array.of(0)));
    await expect(open(overrun)).rejects.toThrow('failed to inflate');
  });

  test('refuse a frame that inflates past the limit', async () => {
    const key = await createAesKey();
    const frame = await createFrameSealer(key, CHANNEL_COMPRESSION)(encodeText(large));
    await expect(createFrameOpener(key, CHANNEL_COMPRESSION, 1024)(frame)).rejects.toThrow('past the limit');
  });
});
