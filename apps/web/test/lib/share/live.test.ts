import { describe, expect, it } from 'bun:test';
import type { ShareLiveView } from '@shinsa/core';
import { waitFor } from '@testing-library/react';
import {
  openShareStream,
  SHARE_OFFLINE,
  SHARE_UNREACHABLE,
  type ShareStreamHandlers,
} from '@/lib/share/live.ts';
import { ShareGoneError } from '@/lib/share/sources.ts';
import type { SharedSource } from '@/lib/share/view.ts';
import { createSharedTask, DIFF } from './fixtures.ts';
import { createFakeShareMachine, SHARE_LINK } from './machine.ts';

function createView(files: ShareLiveView['files'] = {}, updatedAt = 1): ShareLiveView {
  return { shared: createSharedTask(), files, updatedAt };
}

function listen() {
  const sources: SharedSource[] = [];
  const errors: Error[] = [];
  const handlers: ShareStreamHandlers = {
    onSource: (source) => sources.push(source),
    onError: (error) => errors.push(error),
  };
  return { sources, errors, handlers };
}

describe('a live share link', () => {
  it('opens the machine’s channel with a hello only the link’s key could sign, and shows what it streams', async () => {
    const machine = createFakeShareMachine();
    const { sources, handlers } = listen();
    const stop = openShareStream(SHARE_LINK, handlers, machine.options);
    await machine.ready;
    expect(machine.latest().url).toBe(`wss://t-k3x9.shinsa.dev/share?id=${SHARE_LINK.shareId}`);
    expect(machine.latest().binaryType).toBe('arraybuffer');
    expect(machine.latest().sent).toHaveLength(1);
    await machine.sendView(createView({ diff: { version: 'v1', type: 'text/plain' } }));
    await waitFor(() => expect(sources).toHaveLength(1));
    expect(sources[0]?.shared.owner).toBe('mona');
    expect(sources[0]?.resolveFileUrl('diff')).toBeNull();
    await machine.sendFile('diff', 'v1', 'text/plain', DIFF);
    await waitFor(() => expect(sources).toHaveLength(2));
    expect(sources[1]?.resolveFileUrl('diff')).toBe('blob:share-1');
    expect(sources[1]?.resolveFileUrl('lost')).toBeNull();
    await machine.sendFile('diff', 'v2', 'text/plain', DIFF);
    await waitFor(() => expect(machine.revoked).toEqual(['blob:share-1']));
    stop();
    expect(machine.latest().closed).toBe(true);
    expect(machine.revoked).toEqual(['blob:share-1', 'blob:share-2']);
  });

  it('stops for good when sharing stops, or the machine refuses the key', async () => {
    const machine = createFakeShareMachine();
    const { errors, handlers } = listen();
    openShareStream(SHARE_LINK, handlers, machine.options);
    await machine.ready;
    await machine.send({ t: 'closed', reason: 'This task is no longer shared.' });
    await waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0]).toBeInstanceOf(ShareGoneError);
    expect(errors[0]?.message).toBe('This task is no longer shared.');
    expect(machine.waits).toEqual([]);
    const wrong = createFakeShareMachine();
    wrong.key = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const refused = listen();
    openShareStream(SHARE_LINK, refused.handlers, wrong.options);
    await waitFor(() => expect(refused.errors[0]?.message).toBe('Wrong key.'));
  });

  it('a welcome signed without the link’s key is refused, so a stand-in for the machine shows nothing', async () => {
    const machine = createFakeShareMachine();
    machine.answer = () => Promise.resolve();
    const { errors, handlers } = listen();
    openShareStream(SHARE_LINK, handlers, machine.options);
    await waitFor(() => expect(machine.latest().sent).toHaveLength(1));
    machine
      .latest()
      .emit('message', { data: JSON.stringify({ type: 'welcome', ephemeral: 'x', proof: 'AAAA' }) });
    await waitFor(() => expect(errors[0]).toBeInstanceOf(ShareGoneError));
  });

  it('uses the browser’s socket, blob addresses and timers by default', async () => {
    const machine = createFakeShareMachine();
    const original = globalThis.WebSocket;
    globalThis.WebSocket = function createFakeSocket(url: string) {
      return machine.options.createSocket(url);
    } as unknown as typeof WebSocket;
    const { sources, errors, handlers } = listen();
    const stop = openShareStream(SHARE_LINK, handlers, { fetch: machine.options.fetch });
    await machine.ready;
    globalThis.WebSocket = original;
    await machine.sendView(createView({ shot: { version: 'v1', type: 'image/png' } }));
    await machine.sendFile('shot', 'v1', 'image/png', 'png');
    await waitFor(() => expect(sources.at(-1)?.resolveFileUrl('shot')).toStartWith('blob:'));
    machine.latest().emit('close', {});
    await waitFor(() => expect(errors).toHaveLength(1));
    stop();
  });

  it('says a link that names no machine is gone, and tries again when app.shinsa.dev or the machine is away', async () => {
    const gone = createFakeShareMachine();
    gone.status = 404;
    const missing = listen();
    openShareStream(SHARE_LINK, missing.handlers, gone.options);
    await waitFor(() => expect(missing.errors[0]).toBeInstanceOf(ShareGoneError));
    const machine = createFakeShareMachine();
    machine.status = 503;
    const { errors, handlers, sources } = listen();
    const stop = openShareStream(SHARE_LINK, handlers, machine.options);
    await waitFor(() => expect(errors.map((error) => error.message)).toEqual([SHARE_UNREACHABLE]));
    machine.status = 200;
    machine.online = false;
    machine.waits.shift()?.();
    await waitFor(() => expect(errors.at(-1)?.message).toBe(SHARE_OFFLINE));
    machine.online = true;
    machine.waits.shift()?.();
    await machine.ready;
    machine.latest().emit('close', {});
    await waitFor(() => expect(errors).toHaveLength(3));
    machine.waits.shift()?.();
    await waitFor(() => expect(machine.sockets).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 10));
    await machine.sendView(createView());
    await waitFor(() => expect(sources).toHaveLength(1));
    stop();
    machine.latest().emit('close', {});
    expect(errors).toHaveLength(3);
  });

  it('closes on anything it cannot read: a broken frame, a text message after the welcome, or no frame at all', async () => {
    const unreachable = createFakeShareMachine();
    const offline = listen();
    openShareStream(SHARE_LINK, offline.handlers, {
      ...unreachable.options,
      fetch: (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch,
    });
    await waitFor(() => expect(offline.errors[0]?.message).toBe(SHARE_UNREACHABLE));
    const machine = createFakeShareMachine();
    const { errors, handlers } = listen();
    openShareStream(SHARE_LINK, handlers, machine.options);
    await machine.ready;
    machine.latest().emit('message', { data: 'again' });
    await waitFor(() => expect(errors.at(-1)?.message).toBe(SHARE_OFFLINE));
    const garbled = createFakeShareMachine();
    const read = listen();
    openShareStream(SHARE_LINK, read.handlers, garbled.options);
    await garbled.ready;
    garbled.latest().emit('message', { data: new Uint8Array([1, 2]).buffer });
    await waitFor(() => expect(read.errors).toHaveLength(1));
    const strange = createFakeShareMachine();
    const odd = listen();
    openShareStream(SHARE_LINK, odd.handlers, strange.options);
    await strange.ready;
    await strange.send({ t: 'end', id: 'never-started' });
    await strange.send({ t: 'body', id: 'never-started', chunk: '!' });
    if (!strange.seal) throw new Error('not open');
    const frame = await strange.seal(new TextEncoder().encode('{"t":"nope"}') as never);
    strange.latest().emit('message', { data: frame.buffer });
    await waitFor(() =>
      expect(odd.errors[0]?.message).toBe(
        'The machine sent something this page cannot read. Reload the page.'
      )
    );
  });
});
