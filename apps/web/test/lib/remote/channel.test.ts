import { describe, expect, it } from 'bun:test';
import { CHANNEL_BODY_CHUNK_BYTES, serializeBase64Url, serializePublicKey } from '@shinsa/core';
import { waitFor } from '@testing-library/react';
import { ChannelError, openRemoteChannel } from '@/lib/remote/channel.ts';
import { createKeyPair, FakeMac, type FakeMacOptions } from './fake-mac.ts';

const SECRET = serializeBase64Url(new Uint8Array(32).fill(5));

async function connect(
  options: FakeMacOptions = {},
  overrides: { machineKey?: string; secret?: string } = {}
) {
  const device = await createKeyPair();
  const deviceKey = await serializePublicKey(device.publicKey);
  const mac = await FakeMac.create({ enrolled: [deviceKey], ...options });
  const opening = openRemoteChannel({
    url: 'wss://t-k3x9.shinsa.dev/remote?token=t',
    machineKey: overrides.machineKey ?? mac.machineKey,
    device,
    enrollSecret: overrides.secret ?? null,
    openSocket: mac.openSocket,
  });
  return { mac, device, deviceKey, opening };
}

function untilSent(mac: FakeMac, count: number) {
  return waitFor(() => expect(mac.received.filter((message) => message.t === 'end')).toHaveLength(count));
}

function readText(response: Response) {
  return response.text();
}

describe('the sealed channel to a Mac', () => {
  it('opens a real WebSocket to the URL when the page gives no other', async () => {
    const RealWebSocket = globalThis.WebSocket;
    const mac = await FakeMac.create();
    globalThis.WebSocket = function openFakeSocket(url: string) {
      return mac.openSocket(url);
    } as unknown as typeof WebSocket;
    Object.assign(globalThis.WebSocket, { CONNECTING: 0, OPEN: 1 });
    const device = await createKeyPair();
    mac.enrolled.add(await serializePublicKey(device.publicKey));
    const channel = await openRemoteChannel({
      url: 'wss://x/remote',
      machineKey: mac.machineKey,
      device,
      enrollSecret: null,
    });
    globalThis.WebSocket = RealWebSocket;
    expect(mac.urls).toEqual(['wss://x/remote']);
    channel.close();
  });

  it('opens for an enrolled device, carries the app socket and confirms the key both ways', async () => {
    const { mac, opening } = await connect();
    const channel = await opening;
    expect(mac.urls).toEqual(['wss://t-k3x9.shinsa.dev/remote?token=t']);
    expect(channel.isOpen).toBe(true);
    expect(mac.last.binaryType).toBe('arraybuffer');
    const heard: string[] = [];
    const stop = channel.subscribeSocket((data) => heard.push(data));
    await channel.sendSocket('{"type":"state.sync"}');
    await waitFor(() => expect(heard).toEqual(['echo:{"type":"state.sync"}']));
    expect(mac.received[0]).toEqual({ t: 'ready' });
    expect(mac.socketMessages).toEqual(['{"type":"state.sync"}']);
    stop();
    channel.close();
    expect(channel.isClosed).toBe(true);
    expect(mac.last.closedWith).toEqual({ code: 1000, reason: undefined });
    await expect(channel.sendSocket('late')).rejects.toThrow('closed');
  });

  it('enrolls a new device with the one-time secret, and refuses one without it', async () => {
    const enrolling = await connect({ enrolled: [], enrollSecret: SECRET }, { secret: SECRET });
    await enrolling.opening;
    expect(enrolling.mac.enrolled.has(enrolling.deviceKey)).toBe(true);
    const stranger = await connect({ enrolled: [], enrollSecret: SECRET });
    const refusal = await stranger.opening.catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(ChannelError);
    expect(refusal).toMatchObject({ refused: true, message: 'This browser is not enrolled on this Mac.' });
  });

  it('never opens against a Mac whose key is not the pinned one', async () => {
    const impostor = await createKeyPair();
    const { opening } = await connect(
      { tolerant: true },
      { machineKey: await serializePublicKey(impostor.publicKey) }
    );
    await expect(opening).rejects.toThrow('broke');
    const strict = await connect({}, { machineKey: await serializePublicKey(impostor.publicKey) });
    await expect(strict.opening).rejects.toBeInstanceOf(ChannelError);
  });

  it('refuses a pinned key that is not a key, a welcome it cannot read, and a Mac it cannot reach', async () => {
    await expect((await connect({}, { machineKey: 'nope' })).opening).rejects.toThrow('not valid');
    await expect((await connect({ welcome: () => '{"type":"other"}' })).opening).rejects.toThrow(
      'something else'
    );
    await expect((await connect({ refuseOpen: true })).opening).rejects.toThrow('Couldn’t reach');
  });

  it('carries HTTP requests with bodies in chunks and streams the answer back', async () => {
    const big = new Uint8Array(CHANNEL_BODY_CHUNK_BYTES + 7).fill(3);
    const { opening } = await connect({
      respond: async (request) => {
        const sent = new Uint8Array(await request.arrayBuffer());
        if (request.method === 'POST')
          return new Response(big, { status: 201, headers: { 'x-sent': String(sent.length) } });
        if (request.url.endsWith('/empty')) return new Response(null, { status: 204 });
        return new Response(`got ${new URL(request.url).pathname}${new URL(request.url).search}`);
      },
    });
    const channel = await opening;
    const read = await channel.request({ method: 'GET', path: '/api/tasks?x=1', headers: [], body: null });
    expect(await readText(read)).toBe('got /api/tasks?x=1');
    const posted = await channel.request({
      method: 'POST',
      path: '/api/attachments',
      headers: [['content-type', 'application/octet-stream']],
      body: big,
    });
    expect(posted.status).toBe(201);
    expect(posted.headers.get('x-sent')).toBe(String(big.length));
    expect((await posted.arrayBuffer()).byteLength).toBe(big.length);
    const empty = await channel.request({ method: 'GET', path: '/api/empty', headers: [], body: null });
    expect(empty.status).toBe(204);
  });

  it('aborts a request on the Mac and in the page, and fails open requests when the channel drops', async () => {
    const { mac, opening } = await connect();
    const channel = await opening;
    const controller = new AbortController();
    const aborted = channel.request({
      method: 'GET',
      path: '/api/slow',
      headers: [],
      body: null,
      signal: controller.signal,
    });
    await untilSent(mac, 1);
    controller.abort();
    await expect(aborted).rejects.toThrow('aborted');
    await waitFor(() => expect(mac.aborted).toEqual(['1']));
    const closes: string[] = [];
    channel.subscribeClose((error) => closes.push(error.message));
    const hanging = channel.request({ method: 'GET', path: '/api/slow', headers: [], body: null });
    await untilSent(mac, 2);
    mac.last.drop('Mac went to sleep');
    await expect(hanging).rejects.toThrow('Mac went to sleep');
    expect(closes).toEqual(['Mac went to sleep']);
    await expect(channel.request({ method: 'GET', path: '/api', headers: [], body: null })).rejects.toThrow(
      'closed'
    );
  });

  it('streams a body that is still coming and fails it when the channel breaks', async () => {
    const { mac, opening } = await connect();
    const channel = await opening;
    const answer = channel.request({ method: 'GET', path: '/api/stream', headers: [], body: null });
    await untilSent(mac, 1);
    await mac.last.sealed({ t: 'response', id: '1', status: 200, headers: [] });
    const response = await answer;
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    await mac.last.sealed({ t: 'body', id: '1', chunk: serializeBase64Url(new Uint8Array([1, 2])) });
    expect([...((await reader.read()).value ?? [])]).toEqual([1, 2]);
    await mac.last.sealed({ t: 'body', id: '9', chunk: 'AA' });
    await mac.last.sealed({ t: 'response', id: '1', status: 200, headers: [] });
    await mac.last.sealed({ t: 'end', id: '9' });
    mac.last.drop();
    await expect(reader.read()).rejects.toThrow('closed');
  });

  it('refuses an end without a response, and closes on anything a Mac should not send', async () => {
    const ended = await connect();
    const channel = await ended.opening;
    const answer = channel.request({ method: 'GET', path: '/api/x', headers: [], body: null });
    await untilSent(ended.mac, 1);
    await ended.mac.last.sealed({ t: 'end', id: '1' });
    await expect(answer).rejects.toThrow('without answering');
    await ended.mac.last.sealed({ t: 'abort', id: '1' });
    await waitFor(() => expect(channel.isClosed).toBe(true));
    for (const send of [
      (mac: FakeMac) => mac.last.deliver('plain text'),
      (mac: FakeMac) => mac.last.sealedText('not a message'),
      (mac: FakeMac) => mac.last.deliver(new Uint8Array([1, 2, 3]).buffer),
    ]) {
      const other = await connect();
      const opened = await other.opening;
      await send(other.mac);
      await waitFor(() => expect(opened.isClosed).toBe(true));
    }
  });
});
