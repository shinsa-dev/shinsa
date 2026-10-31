import { describe, expect, test } from 'bun:test';
import type { RemoteSnapshot } from '../../src/remote/index.ts';
import { listAgentSpecs, SURFACE } from '../../src/surface/index.ts';
import { createFakeClient, runSpec } from './fixtures.ts';

const REQUEST = {
  id: 'r1',
  kind: 'invite',
  publicKey: 'dev-3',
  deviceName: 'Kai iPhone',
  user: { id: '7', login: 'kai', name: 'Kai Lane', avatarUrl: null },
  requestedAt: 0,
} as const;

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
  access: null,
  links: [],
  requests: [],
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
    {
      publicKey: 'dev-1',
      name: 'iPhone',
      enrolledAt: 0,
      lastSeenAt: Date.UTC(2026, 9, 30),
      userId: '1',
    },
    { publicKey: 'dev-2', name: 'iPad', enrolledAt: 0, lastSeenAt: null, userId: '7' },
  ],
  access: {
    owner: { id: '1', login: 'mona', name: null, avatarUrl: null },
    members: [
      { user: { id: '7', login: 'kai', name: 'Kai Lane', avatarUrl: null }, addedAt: 0 },
      { user: { id: '8', login: 'lee', name: null, avatarUrl: null }, addedAt: 0 },
    ],
  },
};

describe('shinsa remote', () => {
  test('status says how to turn it on, how pairing goes, and who can reach this machine', async () => {
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
        'Open it in Shinsa Cloud at https://app.shinsa.dev.',
        'Added devices:',
        '  iPhone (last used 2026-10-30T00:00:00.000Z) dev-1',
        '  iPad (never used, added by @kai) dev-2',
        'Members:',
        '  Kai Lane (@kai)',
        '  @lee',
      ].join('\n')
    );
    const paused = await runSpec(
      createFakeClient({
        '/api/remote/disable': { ...ON, enabled: false, owner: null, devices: [], access: null },
      }),
      ['remote', 'disable']
    );
    expect(paused.text).toContain('Remote access is paused for Studio, signed in as unknown.');
    expect(paused.text).toContain('No devices are added.');
    expect(paused.text).toContain('No one else has access. Invite someone with `shinsa remote link invite`.');
  });

  test('turns it on, removes it and forgets devices through their routes', async () => {
    const fake = createFakeClient({
      '/api/remote/enable': ON,
      '/api/remote/remove': OFF,
      '/api/remote/devices/remove': ON,
    });
    await runSpec(fake, ['remote', 'enable']);
    await runSpec(fake, ['remote', 'remove']);
    await runSpec(fake, ['remote', 'forget-device', 'dev-1']);
    expect(fake.posts).toEqual([
      { path: '/api/remote/enable', body: {} },
      { path: '/api/remote/remove', body: {} },
      { path: '/api/remote/devices/remove', body: { publicKey: 'dev-1' } },
    ]);
  });

  test('makes and turns off links, and shows them with the waiting requests', async () => {
    const linked: RemoteSnapshot = {
      ...ON,
      links: [
        { kind: 'device', url: 'https://app.shinsa.dev/enroll#k3x9.key.secret', createdAt: 0 },
        { kind: 'invite', url: 'https://app.shinsa.dev/enroll#k3x9.key.secret.invite', createdAt: 0 },
      ],
      requests: [REQUEST],
    };
    const fake = createFakeClient({
      '/api/remote/links/create': linked,
      '/api/remote/links/remove': ON,
      '/api/remote': linked,
    });
    const device = await runSpec(fake, ['remote', 'link', 'device']);
    expect(device.text).toBe(
      'Open this link on your device and sign in as you. Each device asks for access, which you accept or decline:\nhttps://app.shinsa.dev/enroll#k3x9.key.secret'
    );
    const invite = await runSpec(fake, ['remote', 'link', 'invite']);
    expect(invite.text).toContain('Anyone who opens it signs in with GitHub');
    await runSpec(fake, ['remote', 'link-off', 'invite']);
    expect(fake.posts).toEqual([
      { path: '/api/remote/links/create', body: { kind: 'device' } },
      { path: '/api/remote/links/create', body: { kind: 'invite' } },
      { path: '/api/remote/links/remove', body: { kind: 'invite' } },
    ]);
    const status = await runSpec(fake, ['remote', 'status']);
    expect(status.text).toContain(
      'Add device (your own account) link: https://app.shinsa.dev/enroll#k3x9.key.secret'
    );
    expect(status.text).toContain('  r1 Kai Lane (@kai) asks to add Kai iPhone');
    const none = createFakeClient({ '/api/remote/links/create': ON });
    expect((await runSpec(none, ['remote', 'link', 'device'])).text).toContain('No link was made.');
  });

  test('accepts and declines a request by its id or by the login that asked', async () => {
    const twice: RemoteSnapshot = { ...ON, requests: [REQUEST, { ...REQUEST, id: 'r2' }] };
    const fake = createFakeClient({
      '/api/remote': { ...ON, requests: [REQUEST] },
      '/api/remote/requests/accept': ON,
      '/api/remote/requests/decline': ON,
    });
    await runSpec(fake, ['remote', 'accept', '@Kai']);
    await runSpec(fake, ['remote', 'decline', 'r1']);
    expect(fake.posts).toEqual([
      { path: '/api/remote/requests/accept', body: { requestId: 'r1' } },
      { path: '/api/remote/requests/decline', body: { requestId: 'r1' } },
    ]);
    await expect(runSpec(fake, ['remote', 'accept', 'nobody'])).rejects.toThrow(
      'No access request matches nobody'
    );
    const many = createFakeClient({ '/api/remote': twice });
    await expect(runSpec(many, ['remote', 'accept', 'kai'])).rejects.toThrow('@kai asked more than once');
  });

  test('removes a member by their GitHub login', async () => {
    const fake = createFakeClient({ '/api/remote': ON, '/api/remote/members/remove': ON });
    await runSpec(fake, ['remote', 'remove-member', '@Kai']);
    expect(fake.posts).toEqual([{ path: '/api/remote/members/remove', body: { userId: '7' } }]);
    await expect(runSpec(fake, ['remote', 'remove-member', 'nobody'])).rejects.toThrow(
      '@nobody has no access to this machine.'
    );
    const off = createFakeClient({ '/api/remote': OFF });
    await expect(runSpec(off, ['remote', 'remove-member', 'kai'])).rejects.toThrow('@kai has no access');
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
