import { describe, expect, test } from 'bun:test';
import { decodeText, encodeText } from '../../src/remote/bytes.ts';
import { createFrameOpener, createFrameSealer, FrameError } from '../../src/remote/frames.ts';
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
