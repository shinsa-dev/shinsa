import { describe, expect, it } from 'bun:test';
import type { RemoteInstance } from '@shinsa/core';
import { describeMachine } from '@/lib/remote/machines.ts';
import { listAddDeviceSteps } from '@/lib/remote/setup-steps.ts';
import {
  describeDesktopSource,
  describeMachineChoice,
  describeMissingMachine,
  isInScope,
  listScopedRows,
  resolveInviteLinkPath,
  resolveMachineScope,
  resolveMissingMachine,
  resolvePinnedMachine,
} from '@/lib/remote/viewer-mode.ts';

const STUDIO = { id: 'k3x9', name: 'Studio' };

const MACHINE_KEY = 'BOuB1lQ7xT4hH0uY1xKpE0dJ8wQ2r1n5o1yJ2v6H6Hc1Wl9xJ0sV2bq3cQ4uC5mE2c1Q4z8pR7tY0wX1aB2cD3';

const FRAGMENT = `k3x9.${MACHINE_KEY}.secret_1.tok`;

function createRow(id: string, name: string) {
  const instance: RemoteInstance = {
    id,
    name,
    fingerprint: 'abcd 1234',
    online: true,
    lastSeenAt: 1,
    createdAt: 0,
    owner: { id: '1', login: 'mona', name: null, avatarUrl: null },
    role: 'owner',
  };
  return describeMachine(instance, null, 2);
}

describe('which machines the page shows', () => {
  it('shows every machine in a browser and in an app on its own engine', () => {
    expect(resolveMachineScope(null)).toEqual({ kind: 'every' });
    expect(resolveMachineScope({ kind: 'local' })).toEqual({ kind: 'every' });
    expect(isInScope({ kind: 'every' }, 'v9q1')).toBe(true);
  });

  it('asks for a machine in an app on Shinsa Cloud with none chosen, and shows only the one chosen', () => {
    expect(resolveMachineScope({ kind: 'cloud', machine: null })).toEqual({ kind: 'choose' });
    const scope = resolveMachineScope({ kind: 'cloud', machine: STUDIO });
    expect(scope).toEqual({ kind: 'one', machine: STUDIO });
    expect(isInScope(scope, 'k3x9')).toBe(true);
    expect(isInScope(scope, 'v9q1')).toBe(false);
  });

  it('keeps only the chosen machine’s rows', () => {
    const studio = createRow('k3x9', 'Studio');
    const rows = [studio, createRow('v9q1', 'Laptop')];
    expect(listScopedRows(rows, { kind: 'one', machine: STUDIO })).toEqual([studio]);
    expect(listScopedRows(rows, { kind: 'every' })).toEqual(rows);
  });

  it('names the chosen machine when the account no longer has it', () => {
    const scope = resolveMachineScope({ kind: 'cloud', machine: STUDIO });
    expect(resolveMissingMachine(scope, [createRow('k3x9', 'Studio')])).toBeNull();
    expect(resolveMissingMachine(scope, [createRow('v9q1', 'Laptop')])).toBe('Studio');
    expect(resolveMissingMachine({ kind: 'every' }, [])).toBeNull();
    expect(describeMissingMachine('Studio')).toContain('Studio is no longer on your account');
  });

  it('says whether each machine is added to this app', () => {
    const device = { instanceId: 'k3x9', machineKey: 'mk', keys: {} as CryptoKeyPair, enrolledAt: 0 };
    expect(describeMachineChoice({ status: 'Online', device: null })).toBe(
      'Online · Not added to this app yet'
    );
    expect(describeMachineChoice({ status: 'Online', device })).toBe('Online · Added to this app');
    expect(
      describeMachineChoice({ status: 'Online', device: { ...device, waiting: { machineName: 'Studio' } } })
    ).toBe('Online · Waiting for an answer');
  });

  it('pins a machine by its id and name', () => {
    expect(resolvePinnedMachine(createRow('k3x9', 'Studio'))).toEqual(STUDIO);
  });
});

describe('an invite link pasted in the app', () => {
  it('opens the enroll page with the link’s key from any origin', () => {
    expect(resolveInviteLinkPath(` https://app.shinsa.dev/enroll#${FRAGMENT} `)).toBe(`/enroll#${FRAGMENT}`);
    expect(resolveInviteLinkPath(`http://127.0.0.1:5195/enroll?on=machine#${FRAGMENT}`)).toBe(
      `/enroll#${FRAGMENT}`
    );
  });

  it('refuses text, another page and a broken key', () => {
    expect(resolveInviteLinkPath('Studio')).toBeNull();
    expect(resolveInviteLinkPath(`https://app.shinsa.dev/claim#${FRAGMENT}`)).toBeNull();
    expect(resolveInviteLinkPath('https://app.shinsa.dev/enroll#k3x9.only')).toBeNull();
  });

  it('tells the app to paste the link instead of scanning it', () => {
    expect(listAddDeviceSteps(['Studio'], true)[1]).toBe('Copy the link, paste it below and ask for access.');
    expect(listAddDeviceSteps(['Studio'])[1]).toContain('Scan the QR code');
  });
});

describe('the engine in Settings', () => {
  it('says which engine the app shows', () => {
    expect(describeDesktopSource({ kind: 'local' }).title).toBe('This Mac');
    expect(describeDesktopSource({ kind: 'cloud', machine: null })).toEqual({
      title: 'Shinsa Cloud',
      detail: 'No machine chosen yet.',
    });
    expect(describeDesktopSource({ kind: 'cloud', machine: STUDIO }).title).toBe('Studio');
  });
});
