import { describe, expect, it } from 'bun:test';
import { createState } from '@shinsa/core';
import {
  createSampleFleet,
  createSampleMachineServices,
  createSampleRemote,
  createSampleRemoteActions,
  createStaticConnection,
} from '@/routes/ui/sample-remote.ts';

const NOW = 1_800_000_000_000;

const REFUSED = 'This is a sample. Nothing changes here.';

describe('the /ui remote access samples', () => {
  it('show each Remote access state, and change nothing but a sample device link', async () => {
    expect(createSampleRemote(NOW).map((sample) => sample.snapshot.status)).toEqual([
      'off',
      'off',
      'connected',
      'connected',
      'off',
    ]);
    const actions = createSampleRemoteActions();
    await expect(actions.pair()).rejects.toThrow(REFUSED);
    for (const refused of [actions.cancelPairing, actions.resume, actions.pause, actions.remove])
      await expect(refused()).rejects.toThrow(REFUSED);
    await expect(actions.forgetDevice('dev-1')).rejects.toThrow(REFUSED);
    for (const kind of ['device', 'invite'] as const) {
      await expect(actions.createLink(kind)).rejects.toThrow(REFUSED);
      await expect(actions.removeLink(kind)).rejects.toThrow(REFUSED);
    }
    await expect(actions.acceptRequest('request-1')).rejects.toThrow(REFUSED);
    await expect(actions.declineRequest('request-1')).rejects.toThrow(REFUSED);
  });

  it('list four machines, one shared, two of them added in this browser, and refuse every change', async () => {
    const { dashboard, devices } = createSampleMachineServices(NOW);
    const macs = await dashboard.listInstances();
    expect(macs.map((mac) => [mac.name, mac.online, mac.lastSeenAt])).toEqual([
      ['Studio', true, NOW],
      ['MacBook Air', false, NOW - 26 * 3_600_000],
      ['Office mini', true, NOW],
      ['Team server', true, NOW],
    ]);
    expect(await devices.selectDevice('k3x9')).toMatchObject({ instanceId: 'k3x9' });
    expect(await devices.selectDevice('w4t8')).toBeNull();
    await expect(dashboard.readSession()).rejects.toThrow(REFUSED);
  });

  it('merge two machines that never connect, send nothing, and keep every call quiet', async () => {
    const fleet = createSampleFleet([
      { name: 'Studio', state: createState() },
      { name: 'Laptop', state: createState() },
    ]);
    fleet.start();
    fleet.reset();
    fleet.flush();
    expect(fleet.snapshot().status).toBe('open');
    expect(fleet.members.map((member) => member.name)).toEqual(['Studio', 'Laptop']);
    expect(fleet.selectTranscript('run')).toEqual([]);
    fleet.watchTranscript('run')();
    fleet.subscribe(() => undefined)();
    expect(fleet.selectAccounts()).toBeNull();
    fleet.replaceAccounts(null as never);
    expect(fleet.isDesktopConnected()).toBe(false);
    expect(fleet.selectTerminals()).toBeNull();
    fleet.replaceTerminals(null as never);
    expect(fleet.selectRemote()).toBeNull();
    fleet.replaceRemote(null as never);
    expect(fleet.selectMachine('task')).toBeNull();
    expect(fleet.listMachines().map((machine) => machine.name)).toEqual(['Studio', 'Laptop']);
    expect(fleet.listUnreachableMachines()).toEqual([]);
    const single = createStaticConnection(createState());
    expect(single.listMachines()).toEqual([]);
    expect(single.listUnreachableMachines()).toEqual([]);
    expect(single.listMachineAccess()).toEqual([]);
    await expect(fleet.command({ type: 'focus.clear' } as never)).rejects.toThrow(REFUSED);
    await expect(fleet.fetch(new Request('http://mac/api/tasks'))).rejects.toThrow('Nothing is sent.');
    fleet.close();
  });
});
