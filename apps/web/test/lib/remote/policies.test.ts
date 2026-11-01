import { describe, expect, it } from 'bun:test';
import type { MachineChoice } from '@/lib/connection/socket.ts';
import {
  describePolicyCount,
  describePolicyLength,
  describePolicySubmit,
  listPolicyGroups,
  listPolicyMachineItems,
  POLICY_ACTIONS,
  resolvePolicyRemoval,
  resolvePolicyWrites,
  validatePolicy,
} from '@/lib/remote/policies.ts';
import { spyOnCommands } from '../../support/commands.ts';

function machine(id: string, name: string, policies?: string[], current = false): MachineChoice {
  return {
    id,
    name,
    current,
    state: { tasks: {}, projects: {}, settings: policies ? { placementPolicies: policies } : {} },
  };
}

const STUDIO = machine('studio', 'Studio', ['iOS, simulator', 'Xcode'], true);
const SERVER = machine('server', 'Server');

describe('placement policies', () => {
  it('groups policies by machine and names this machine as such', () => {
    expect(listPolicyGroups([STUDIO, SERVER]).map((group) => [group.machine.id, group.policies])).toEqual([
      ['studio', ['iOS, simulator', 'Xcode']],
      ['server', []],
    ]);
    expect(listPolicyMachineItems([STUDIO, SERVER])).toEqual([
      { value: 'studio', label: 'This machine' },
      { value: 'server', label: 'Server' },
    ]);
    expect(
      listPolicyMachineItems(
        [STUDIO],
        [
          { id: 'studio', name: 'Studio' },
          { id: 'laptop', name: 'Laptop' },
          { id: 'box', name: 'Build box', outdated: true },
        ]
      )
    ).toEqual([
      { value: 'studio', label: 'This machine' },
      { value: 'laptop', label: 'Laptop', disabled: 'Add this device on Laptop first' },
      { value: 'box', label: 'Build box', disabled: 'Update Shinsa on Build box to reach it from here.' },
    ]);
    expect(describePolicyCount(2)).toBe('2 of 20');
    expect(describePolicyLength(' iOS ')).toBe('3 / 240');
    expect(describePolicySubmit(null)).toBe('Add routing policy');
    expect(describePolicySubmit({ machineId: 'studio', index: 0 })).toBe('Save');
  });

  it('refuses an empty, long, repeated or 21st policy, and lets an edit keep its own text', () => {
    expect(validatePolicy([STUDIO], null, 'studio', ' ')).toBe('Write what runs on this machine.');
    expect(validatePolicy([STUDIO], null, 'studio', 'x'.repeat(241))).toBe(
      'Keep it to 240 characters. It has 241.'
    );
    expect(validatePolicy([STUDIO], null, 'studio', 'Xcode')).toBe('That machine already has this policy.');
    expect(validatePolicy([STUDIO], { machineId: 'studio', index: 1 }, 'studio', 'Xcode')).toBeNull();
    const full = machine(
      'full',
      'Full',
      Array.from({ length: 20 }, (_, index) => `w${index}`)
    );
    expect(validatePolicy([full], null, 'full', 'benchmark')).toBe(
      'A machine holds 20 policies. Remove one first.'
    );
    expect(validatePolicy([full], { machineId: 'full', index: 0 }, 'full', 'benchmark')).toBeNull();
    expect(validatePolicy([STUDIO, SERVER], null, 'server', 'benchmark')).toBeNull();
  });

  it('adds, edits in place, moves to another machine and removes', () => {
    const machines = [STUDIO, SERVER];
    expect(resolvePolicyWrites(machines, null, 'server', ' benchmark ')).toEqual([
      { machineId: 'server', policies: ['benchmark'] },
    ]);
    expect(
      resolvePolicyWrites(machines, { machineId: 'studio', index: 1 }, 'studio', 'Xcode, Swift')
    ).toEqual([{ machineId: 'studio', policies: ['iOS, simulator', 'Xcode, Swift'] }]);
    expect(resolvePolicyWrites(machines, { machineId: 'studio', index: 1 }, 'server', 'Xcode')).toEqual([
      { machineId: 'server', policies: ['Xcode'] },
      { machineId: 'studio', policies: ['iOS, simulator'] },
    ]);
    expect(resolvePolicyRemoval(machines, { machineId: 'studio', index: 0 })).toEqual({
      machineId: 'studio',
      policies: ['Xcode'],
    });
    expect(resolvePolicyRemoval(machines, { machineId: 'gone', index: 0 })).toEqual({
      machineId: 'gone',
      policies: [],
    });
  });

  it('sends each machine its policies, confirming once at the end, and stops at a refusal', async () => {
    const spies = spyOnCommands();
    const writes = [
      { machineId: 'server', policies: ['Xcode'] },
      { machineId: 'studio', policies: ['iOS'] },
    ];
    expect(await POLICY_ACTIONS.write(writes, 'Policy saved.')).toBe(true);
    expect(spies.sent.mock.calls).toEqual([
      [{ type: 'settings.change', patch: { placementPolicies: ['Xcode'] } }, undefined, 'server'],
      [{ type: 'settings.change', patch: { placementPolicies: ['iOS'] } }, 'Policy saved.', 'studio'],
    ]);
    spies.sent.mockResolvedValueOnce(false);
    expect(await POLICY_ACTIONS.write(writes, 'Policy saved.')).toBe(false);
    expect(spies.sent).toHaveBeenCalledTimes(3);
    spies.restore();
  });
});
