import { PLACEMENT_POLICY_LIMITS } from '@shinsa/core';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import type { MachineChoice, UnreachableMachine } from '@/lib/connection/socket.ts';
import { describeUnreachableMachine, resolveMachineLabel } from './mode.ts';

export const POLICIES_SECTION = 'Routing policies';

export const POLICY_PLACEHOLDER = 'What runs on this machine, such as “Run Xcode simulator tests here.”';

export interface PolicyRef {
  machineId: string;
  index: number;
}

export interface PolicyWrite {
  machineId: string;
  policies: string[];
}

export interface PolicyGroup {
  machine: MachineChoice;
  policies: string[];
}

export function listPolicyGroups(machines: MachineChoice[]): PolicyGroup[] {
  return machines.map((machine) => ({ machine, policies: machine.state.settings.placementPolicies ?? [] }));
}

export interface PolicyMachineItem {
  value: string;
  label: string;
  disabled?: string;
}

export function listPolicyMachineItems(
  machines: MachineChoice[],
  unreachable: UnreachableMachine[] = []
): PolicyMachineItem[] {
  return [
    ...machines.map((machine) => ({ value: machine.id, label: resolveMachineLabel(machine) })),
    ...unreachable
      .filter((machine) => !machines.some((reachable) => reachable.id === machine.id))
      .map((machine) => ({
        value: machine.id,
        label: machine.name,
        disabled: describeUnreachableMachine(machine),
      })),
  ];
}

export function describePolicyCount(count: number) {
  return `${count} of ${PLACEMENT_POLICY_LIMITS.perMachine}`;
}

export function describePolicyLength(text: string) {
  return `${text.trim().length} / ${PLACEMENT_POLICY_LIMITS.text}`;
}

export function describePolicySubmit(editing: PolicyRef | null) {
  return editing ? 'Save' : 'Add routing policy';
}

function selectPolicies(machines: MachineChoice[], machineId: string) {
  return machines.find((machine) => machine.id === machineId)?.state.settings.placementPolicies ?? [];
}

export function validatePolicy(
  machines: MachineChoice[],
  editing: PolicyRef | null,
  machineId: string,
  text: string
) {
  const length = text.trim().length;
  if (length === 0) return 'Write what runs on this machine.';
  if (length > PLACEMENT_POLICY_LIMITS.text)
    return `Keep it to ${PLACEMENT_POLICY_LIMITS.text} characters. It has ${length}.`;
  const staying = editing?.machineId === machineId;
  const others = selectPolicies(machines, machineId).filter(
    (_, index) => !staying || index !== editing.index
  );
  if (others.includes(text.trim())) return 'That machine already has this policy.';
  if (!staying && others.length >= PLACEMENT_POLICY_LIMITS.perMachine)
    return `A machine holds ${PLACEMENT_POLICY_LIMITS.perMachine} policies. Remove one first.`;
  return null;
}

export function resolvePolicyWrites(
  machines: MachineChoice[],
  editing: PolicyRef | null,
  machineId: string,
  text: string
): PolicyWrite[] {
  const policy = text.trim();
  const target = selectPolicies(machines, machineId);
  if (editing?.machineId === machineId)
    return [
      { machineId, policies: target.map((entry, index) => (index === editing.index ? policy : entry)) },
    ];
  const writes: PolicyWrite[] = [{ machineId, policies: [...target, policy] }];
  if (editing) writes.push(resolvePolicyRemoval(machines, editing));
  return writes;
}

export function resolvePolicyRemoval(machines: MachineChoice[], ref: PolicyRef): PolicyWrite {
  return {
    machineId: ref.machineId,
    policies: selectPolicies(machines, ref.machineId).filter((_, index) => index !== ref.index),
  };
}

export interface PolicyActions {
  write: (writes: PolicyWrite[], done: string) => Promise<boolean>;
}

export const POLICY_ACTIONS: PolicyActions = {
  write: async (writes, done) => {
    for (const [index, write] of writes.entries()) {
      const sent = await sendCommandWithToast(
        { type: 'settings.change', patch: { placementPolicies: write.policies } },
        index === writes.length - 1 ? done : undefined,
        write.machineId
      );
      if (!sent) return false;
    }
    return true;
  },
};
