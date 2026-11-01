import { describe, expect, it } from 'bun:test';
import { serializePublicKey } from '@shinsa/core';
import { waitFor } from '@testing-library/react';
import { ChannelError, openRemoteChannel } from '@/lib/remote/channel.ts';
import { DashboardError } from '@/lib/remote/dashboard.ts';
import type { EnrolledDevice } from '@/lib/remote/devices.ts';
import { ChannelSocket, RemoteLink } from '@/lib/remote/link.ts';
import { createKeyPair, FakeMac, type FakeMacOptions } from './fake-mac.ts';

async function createLink(options: FakeMacOptions = {}, enrolled = true) {
  const keys = await createKeyPair();
  const deviceKey = await serializePublicKey(keys.publicKey);
  const mac = await FakeMac.create({ enrolled: enrolled ? [deviceKey] : [], ...options });
  const device: EnrolledDevice = { instanceId: 'k3x9', machineKey: mac.machineKey, keys, enrolledAt: 1 };
  const connects: string[] = [];
  const refusals: string[] = [];
  const link = new RemoteLink({
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

  it('reports the machine removed when its connect call answers not found, and nothing else', async () => {
    const keys = await createKeyPair();
    const device: EnrolledDevice = { instanceId: 'k3x9', machineKey: 'key', keys, enrolledAt: 1 };
    const failures = [
      new DashboardError('not_found', 'No such machine.', 404),
      new DashboardError('forbidden', 'This request needs an Origin.', 403),
      new DashboardError('failed', 'Shinsa Cloud is down.', 503),
      new Error('Offline.'),
    ];
    const removed: string[] = [];
    for (const failure of failures) {
      const link = new RemoteLink({
        instanceId: 'k3x9',
        device,
        dashboard: { requestConnect: () => Promise.reject(failure) },
        onRemoved: () => removed.push(failure.message),
      });
      await expect(link.resolveChannel()).rejects.toBe(failure);
    }
    expect(removed).toEqual(['No such machine.']);
  });
});
