import { parseEnrollFragment, REMOTE_PATHS, serializeEnrollFragment } from '@shinsa/core';
import { Option } from 'effect';
import type { DesktopSource, PinnedMachine } from '@/lib/desktop.ts';
import type { MachineRow } from './machines.ts';

export type MachineScope = { kind: 'every' } | { kind: 'choose' } | { kind: 'one'; machine: PinnedMachine };

export const VIEWER_COPY = {
  chooseTitle: 'Choose a machine for this app',
  chooseBody:
    'This app shows one machine you reach through Shinsa Cloud. No engine runs on this Mac while it does.',
  noMachines: 'No machine on your account yet. Turn on remote access on the machine that runs Shinsa.',
  choose: 'Show here',
  useLocal: 'Use this Mac’s engine',
  inviteLabel: 'Invite link',
  invitePlaceholder: 'Paste the machine’s invite link',
  inviteSubmit: 'Ask for access',
  inviteInvalid:
    'This is not a machine’s invite link. Copy it again from Settings > Remote access on the machine.',
  settingsTitle: 'Engine in this app',
  settingsDescription: 'Which Shinsa this app shows. Switching opens the window again.',
  chooseMachine: 'Use a machine',
  chooseAnother: 'Choose another',
} as const;

export function resolveMachineScope(source: DesktopSource | null): MachineScope {
  if (source?.kind !== 'cloud') return { kind: 'every' };
  return source.machine ? { kind: 'one', machine: source.machine } : { kind: 'choose' };
}

export function isInScope(scope: MachineScope, instanceId: string) {
  return scope.kind !== 'one' || scope.machine.id === instanceId;
}

export function listScopedRows<Row extends { instance: { id: string } }>(
  rows: readonly Row[],
  scope: MachineScope
) {
  return rows.filter((row) => isInScope(scope, row.instance.id));
}

export function describeMissingMachine(name: string) {
  return `${name} is no longer on your account, or no longer shared with you. Choose another machine for this app.`;
}

export function resolveMissingMachine(scope: MachineScope, rows: readonly MachineRow[]) {
  if (scope.kind !== 'one') return null;
  return rows.some((row) => row.instance.id === scope.machine.id) ? null : scope.machine.name;
}

export function describeMachineChoice(row: Pick<MachineRow, 'status' | 'device'>) {
  if (!row.device) return `${row.status} · Not added to this app yet`;
  return `${row.status} · ${row.device.waiting ? 'Waiting for an answer' : 'Added to this app'}`;
}

export function resolvePinnedMachine(row: MachineRow): PinnedMachine {
  return { id: row.instance.id, name: row.instance.name };
}

export function resolveInviteLinkPath(text: string) {
  const url = URL.parse(text.trim());
  if (!url || url.pathname !== REMOTE_PATHS.enrollPage) return null;
  return Option.match(parseEnrollFragment(url.hash), {
    onNone: () => null,
    onSome: (fragment) => `${REMOTE_PATHS.enrollPage}#${serializeEnrollFragment(fragment)}`,
  });
}

export function describeDesktopSource(source: DesktopSource) {
  if (source.kind === 'local')
    return { title: 'This Mac', detail: 'The engine on this Mac runs your tasks.' };
  if (!source.machine) return { title: 'Shinsa Cloud', detail: 'No machine chosen yet.' };
  return { title: source.machine.name, detail: 'Reached through Shinsa Cloud.' };
}
