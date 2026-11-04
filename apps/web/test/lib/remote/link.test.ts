import { describe, expect, it } from 'bun:test';
import { serializePublicKey } from '@shinsa/core';
import { waitFor } from '@testing-library/react';
import { Effect } from 'effect';
import { openRemoteChannel } from '@/lib/remote/channel.ts';
import { ChannelSocket, ChannelTerminalSocket, createRemoteLink } from '@/lib/remote/link.ts';
import { ChannelError } from '@/lib/remote/remote-channel/schema.ts';
import type { EnrolledDevice } from '@/lib/remote/schema.ts';
import { CloudRefused, CloudUnreachable } from '@/lib/runtime/remote/schema.ts';
import { createKeyPair, FakeMac, type FakeMacOptions } from './fake-mac.ts';

async function createLink(options: FakeMacOptions = {}, enrolled = true) {
  const keys = await createKeyPair();
  const deviceKey = await Effect.runPromise(serializePublicKey(keys.publicKey));
  const mac = await FakeMac.create({ enrolled: enrolled ? [deviceKey] : [], ...options });
  const device: EnrolledDevice = { instanceId: 'k3x9', machineKey: mac.machineKey, keys, enrolledAt: 1 };
  const connects: string[] = [];
  const refusals: string[] = [];
  const link = createRemoteLink({
    instanceId: 'k3x9',
    device,
    dashboard: {
      requestConnect: (instanceId) => {
        connects.push(instanceId);
        return Promise.resolve({
          url: `wss://t-${instanceId}.shinsa.dev/remote?token=${connects.length}`,
          expiresAt: 0,
        });
      },
    },
    openChannel: (channel) => openRemoteChannel({ ...channel, openSocket: mac.openSocket }),
    onRefused: (error) => refusals.push(error.message),
  });
  return { mac, link, connects, refusals };
}

function listen(socket: WebSocket) {
  const events: string[] = [];
  socket.addEventListener('open', () => events.push('open'));
  socket.addEventListener('message', (event) => events.push(`message:${String(event.data)}`));
  socket.addEventListener('close', (event) => events.push(`close:${event.reason}`));
  return events;
}

describe('the link to a remote machine', () => {
  it('gives the app a socket that opens on the channel and carries its messages', async () => {
    const { mac, link, connects } = await createLink();
    const socket = link.openSocket();
    const events = listen(socket);
    expect(socket.readyState).toBe(0);
    await waitFor(() => expect(events).toEqual(['open']));
    socket.send('{"type":"hello"}');
    await waitFor(() => expect(events).toEqual(['open', 'message:echo:{"type":"hello"}']));
    expect(mac.urls).toEqual(['wss://t-k3x9.shinsa.dev/remote?token=1']);
    expect(connects).toEqual(['k3x9']);
    socket.close();
    socket.send('ignored');
    expect(events.at(-1)).toBe('close:Closed on this page.');
    expect(mac.last.closedWith?.code).toBe(1000);
  });

  it('shares one channel between the socket and requests, and opens a fresh one for a second socket', async () => {
    const { mac, link } = await createLink({ respond: () => new Response('ok') });
    const first = link.openSocket();
    await waitFor(() => expect(first.readyState).toBe(1));
    const answer = await link.fetch(new Request('https://shinsa.dev/api/tasks?x=1'));
    expect(await answer.text()).toBe('ok');
    expect(mac.sockets).toHaveLength(1);
    const posted = await link.fetch(
      new Request('https://shinsa.dev/api/commands', { method: 'POST', body: '{"type":"x"}' })
    );
    expect(posted.status).toBe(200);
    const second = link.openSocket();
    await waitFor(() => expect(second.readyState).toBe(1));
    expect(mac.sockets).toHaveLength(2);
    expect(first.readyState).toBe(3);
  });

  it('reconnects after the channel drops, and closes the socket when the machine refuses the device', async () => {
    const { mac, link, refusals } = await createLink();
    const socket = link.openSocket();
    const events = listen(socket);
    await waitFor(() => expect(events).toEqual(['open']));
    mac.last.drop('asleep');
    await waitFor(() => expect(events).toEqual(['open', 'close:asleep']));
    const again = link.openSocket();
    await waitFor(() => expect(again.readyState).toBe(1));
    expect(mac.sockets).toHaveLength(2);
    mac.enrolled.clear();
    link.close();
    const refused = link.openSocket();
    const refusedEvents = listen(refused);
    await waitFor(() =>
      expect(refusedEvents).toEqual(['close:This browser is not enrolled on this machine.'])
    );
    expect(refusals).toEqual(['This browser is not enrolled on this machine.']);
  });

  it('drops a channel that a newer one replaced while it was opening', async () => {
    const { mac, link } = await createLink();
    const replaced = link.resolveChannel();
    const replacing = link.resolveChannel(true);
    await expect(replaced).rejects.toThrow('newer connection');
    await replacing;
    await waitFor(() => expect(mac.sockets[0]?.closedWith?.code).toBe(1000));
  });

  it('a socket closed before its channel opens closes the channel it gets', async () => {
    const { mac, link } = await createLink();
    const socket = link.openSocket();
    socket.close();
    await waitFor(() => expect(mac.last.closedWith?.code).toBe(1000));
    expect(socket.readyState).toBe(3);
  });

  it('a socket that fails once stays closed', () => {
    const socket = new ChannelSocket();
    const events = listen(socket as unknown as WebSocket);
    socket.fail('first');
    socket.fail('second');
    expect(events).toEqual(['close:first']);
  });

  it('reports a refusal only when the machine refused', async () => {
    const { link, refusals } = await createLink({ refuseOpen: true });
    await expect(link.resolveChannel()).rejects.toBeInstanceOf(ChannelError);
    expect(refusals).toEqual([]);
  });

  it('asks for a fresh connect token for every channel, since a token opens one channel once', async () => {
    const { mac, link, connects } = await createLink();
    await link.resolveChannel();
    await link.resolveChannel(true);
    expect(connects).toHaveLength(2);
    expect(mac.urls).toEqual([
      'wss://t-k3x9.shinsa.dev/remote?token=1',
      'wss://t-k3x9.shinsa.dev/remote?token=2',
    ]);
  });

  it('asks for a fresh token after a channel failed to open', async () => {
    const { mac, link, connects } = await createLink({ refuseOpen: true });
    await expect(link.resolveChannel()).rejects.toBeInstanceOf(ChannelError);
    mac.options = { ...mac.options, refuseOpen: false };
    await link.resolveChannel();
    expect(connects).toHaveLength(2);
  });

  it('reports the machine removed when its connect call answers not found, and nothing else', async () => {
    const keys = await createKeyPair();
    const device: EnrolledDevice = { instanceId: 'k3x9', machineKey: 'key', keys, enrolledAt: 1 };
    const failures = [
      new CloudRefused({ code: 'not_found', message: 'No such machine.', status: 404 }),
      new CloudRefused({ code: 'forbidden', message: 'This request needs an Origin.', status: 403 }),
      new CloudRefused({ code: 'failed', message: 'Shinsa Cloud is down.', status: 503 }),
      new CloudUnreachable({ message: 'Offline.' }),
    ];
    const removed: string[] = [];
    for (const failure of failures) {
      const link = createRemoteLink({
        instanceId: 'k3x9',
        device,
        dashboard: { requestConnect: () => Promise.reject(failure) },
        onRemoved: () => removed.push(failure.message),
      });
      await expect(link.resolveChannel()).rejects.toBe(failure);
    }
    expect(removed).toEqual(['No such machine.']);
  });

  it('fails as a broken channel when connecting throws something that is not a failure it knows', async () => {
    const keys = await createKeyPair();
    const device: EnrolledDevice = { instanceId: 'k3x9', machineKey: 'key', keys, enrolledAt: 1 };
    const failures = [new Error('Offline.'), 'no reason'];
    const messages: string[] = [];
    for (const failure of failures) {
      const link = createRemoteLink({
        instanceId: 'k3x9',
        device,
        dashboard: { requestConnect: () => Promise.reject(failure) },
      });
      const error = await link.resolveChannel().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ChannelError);
      messages.push((error as ChannelError).message);
    }
    expect(messages).toEqual(['Offline.', 'The connection to your machine broke.']);
  });

  it('streams a terminal on the channel: text, bytes, its close, and what the machine sends back', async () => {
    const { mac, link } = await createLink();
    const socket = link.openTerminalSocket('term-1');
    socket.binaryType = 'arraybuffer';
    const heard: unknown[] = [];
    socket.addEventListener('message', (event) => heard.push(event.data));
    const closes: [number, string][] = [];
    socket.addEventListener('close', (event) => closes.push([event.code, event.reason]));
    await waitFor(() => expect(heard).toEqual(['opened:term-1']));
    const [opened] = mac.received.filter((message) => message.t === 'terminal-open');
    const id = opened?.t === 'terminal-open' ? opened.id : '';
    socket.send('{"type":"clear"}');
    socket.send(new TextEncoder().encode('ls'));
    socket.send(new TextEncoder().encode('pwd').buffer);
    await waitFor(() => expect(heard).toHaveLength(4));
    expect(heard[1]).toBe('echo:{"type":"clear"}');
    expect(new TextDecoder().decode(heard[2] as ArrayBuffer)).toBe('ls');
    expect(new TextDecoder().decode(heard[3] as ArrayBuffer)).toBe('pwd');
    await mac.last.sealed({ t: 'terminal-text', id: 'another', data: 'not ours' });
    await mac.last.sealed({ t: 'terminal-bytes', id, chunk: '!' });
    socket.close();
    socket.send('ignored');
    await waitFor(() =>
      expect(mac.received.at(-1)).toEqual({ t: 'terminal-close', id, code: 1000, reason: '' })
    );
    expect(closes).toEqual([[1000, 'Closed on this page.']]);
    expect(heard).toHaveLength(4);
  });

  it('closes a terminal socket with the machine’s code, and when its channel drops or never opens', async () => {
    const { mac, link } = await createLink();
    const refused = link.openTerminalSocket('refused');
    const refusedCloses: number[] = [];
    refused.addEventListener('close', (event) => refusedCloses.push(event.code));
    await waitFor(() => expect(refusedCloses).toEqual([4403]));
    const dropped = link.openTerminalSocket('term-1');
    const droppedCloses: number[] = [];
    dropped.addEventListener('close', (event) => droppedCloses.push(event.code));
    await waitFor(() => expect(dropped.readyState).toBe(1));
    mac.last.drop('The tunnel dropped.');
    await waitFor(() => expect(droppedCloses).toEqual([1006]));
    const early = new ChannelTerminalSocket('term-1', 't-early');
    early.close();
    expect(early.readyState).toBe(3);
    const { link: refusing } = await createLink({}, false);
    const never = refusing.openTerminalSocket('term-1');
    const neverCloses: number[] = [];
    never.addEventListener('close', (event) => neverCloses.push(event.code));
    await waitFor(() => expect(neverCloses).toEqual([1006]));
  });
});
