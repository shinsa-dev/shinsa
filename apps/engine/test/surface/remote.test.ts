import { describe, expect, test } from 'bun:test';
import type { RemoteSnapshot } from '../../src/remote/index.ts';
import { listAgentSpecs, SURFACE } from '../../src/surface/index.ts';
import { createFakeClient, runSpec } from './fixtures.ts';

const OFF: RemoteSnapshot = {
  paired: false,
  enabled: false,
  status: 'off',
  instanceId: null,
  owner: null,
  machineName: 'Studio',
  machineKey: null,
  pairing: null,
  devices: [],
};

const ON: RemoteSnapshot = {
  ...OFF,
  paired: true,
  enabled: true,
  status: 'connected',
  instanceId: 'k3x9',
  owner: 'mona',
  machineKey: 'key',
  devices: [
    { publicKey: 'dev-1', name: 'iPhone', enrolledAt: 0, lastSeenAt: Date.UTC(2026, 9, 30) },
    { publicKey: 'dev-2', name: 'iPad', enrolledAt: 0, lastSeenAt: null },
  ],
};

describe('shinsa remote', () => {
  test('status says how to turn it on, how pairing goes, and who can reach this Mac', async () => {
    const off = await runSpec(createFakeClient({ '/api/remote': OFF }), ['remote', 'status']);
    expect(off.text).toContain('`shinsa remote pair`');
    const pairing = {
      ...OFF,
      pairing: { claimCode: 'K7PQ', url: 'https://app.shinsa.dev/pair', expiresAt: 1 },
    };
    const started = await runSpec(createFakeClient({ '/api/remote/pair': pairing }), ['remote', 'pair']);
    expect(started.text).toBe(
      'Pairing Studio: finish signing in at https://app.shinsa.dev/pair (code K7PQ).'
    );
    const on = await runSpec(createFakeClient({ '/api/remote': ON }), ['remote', 'status']);
    expect(on.text).toBe(
      [
        'Remote access is connected for Studio, signed in as mona.',
        'Open it at https://app.shinsa.dev.',
        'Enrolled devices:',
        '  iPhone (last used 2026-10-30T00:00:00.000Z) dev-1',
        '  iPad (never used) dev-2',
      ].join('\n')
    );
    const paused = await runSpec(
      createFakeClient({ '/api/remote/disable': { ...ON, enabled: false, owner: null, devices: [] } }),
      ['remote', 'disable']
    );
    expect(paused.text).toContain('Remote access is paused for Studio, signed in as unknown.');
    expect(paused.text).toContain('No devices are enrolled.');
  });

  test('turns it on, removes it, enrolls and forgets devices through their routes', async () => {
    const fake = createFakeClient({
      '/api/remote/enable': ON,
      '/api/remote/remove': OFF,
      '/api/remote/devices/remove': ON,
      '/api/remote/devices/enroll': {
        url: 'https://app.shinsa.dev/enroll#k3x9.key.secret',
        name: 'iPhone',
        expiresAt: 1,
      },
    });
    await runSpec(fake, ['remote', 'enable']);
    await runSpec(fake, ['remote', 'remove']);
    await runSpec(fake, ['remote', 'forget-device', 'dev-1']);
    const enrolled = await runSpec(fake, ['remote', 'enroll', 'iPhone']);
    expect(enrolled.text).toBe(
      'Open this link on iPhone within 10 minutes. It works once:\nhttps://app.shinsa.dev/enroll#k3x9.key.secret'
    );
    expect(fake.posts).toEqual([
      { path: '/api/remote/enable', body: {} },
      { path: '/api/remote/remove', body: {} },
      { path: '/api/remote/devices/remove', body: { publicKey: 'dev-1' } },
      { path: '/api/remote/devices/enroll', body: { name: 'iPhone' } },
    ]);
  });

  test('gives agents only the status, never pairing, devices or turning it off', () => {
    const remote = SURFACE.filter((spec) => spec.path[0] === 'remote');
    expect(remote.filter((spec) => !spec.humanOnly).map((spec) => spec.path.join(' '))).toEqual([
      'remote status',
    ]);
    const agentPaths = listAgentSpecs().map((spec) => spec.path.join(' '));
    expect(agentPaths).toContain('remote status');
    expect(agentPaths).not.toContain('remote pair');
  });
});
