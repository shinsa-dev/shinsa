import { type RemoteTeam, resolveKeyFingerprint, type TeamListView } from '@shinsa/core';
import { type ChannelOptions, openRemoteChannel, type RemoteChannel } from '@/lib/remote/channel.ts';
import type { DashboardClient } from '@/lib/remote/dashboard.ts';
import { createDeviceKeys, type DeviceStore, type EnrolledDevice } from '@/lib/remote/devices.ts';
import type { MachineRow } from '@/lib/remote/machines.ts';
import { openTeamChannel, type TeamChannelHandlers, type TeamChannelTarget } from './channel.ts';
import type { StoredTeamKey } from './join.ts';

type OpenTeam = (target: TeamChannelTarget, handlers: TeamChannelHandlers) => () => void;

export interface TeamAdmitOptions {
  dashboard: Pick<DashboardClient, 'listTeams' | 'requestConnect'>;
  devices: Pick<DeviceStore, 'writeDevice'>;
  selectTeamKey: (teamId: string) => Promise<StoredTeamKey | null>;
  name: string;
  openTeam?: OpenTeam;
  openChannel?: (options: ChannelOptions) => Promise<RemoteChannel>;
  createKeys?: () => Promise<CryptoKeyPair>;
  now?: () => number;
}

export function readTeamMachineKey(target: TeamChannelTarget, open: OpenTeam = openTeamChannel) {
  return new Promise<string | null>((resolve) => {
    let done = false;
    let stop: (() => void) | null = null;
    const finish = (key: string | null) => {
      if (done) return;
      done = true;
      resolve(key);
      stop?.();
    };
    stop = open(target, {
      onMessage: (message) => {
        if (message.t === 'view') finish((JSON.parse(message.data) as TeamListView).machineKey ?? null);
      },
      onEnd: () => finish(null),
    });
    if (done) stop();
  });
}

async function enroll(row: MachineRow, machineKey: string, secret: string, options: TeamAdmitOptions) {
  const device: EnrolledDevice = {
    instanceId: row.instance.id,
    machineKey,
    keys: await (options.createKeys ?? createDeviceKeys)(),
    enrolledAt: (options.now ?? Date.now)(),
  };
  try {
    const { url } = await options.dashboard.requestConnect(row.instance.id);
    const channel = await (options.openChannel ?? openRemoteChannel)({
      url,
      machineKey,
      device: device.keys,
      enrollSecret: secret,
      name: options.name,
    });
    channel.close();
  } catch {
    return null;
  }
  await options.devices.writeDevice(device);
  return device;
}

async function admitMachine(row: MachineRow, teams: RemoteTeam[], options: TeamAdmitOptions) {
  for (const team of teams) {
    if (!team.machines.some((machine) => machine.id === row.instance.id)) continue;
    const stored = await options.selectTeamKey(team.id);
    if (!stored) continue;
    const machineKey = await readTeamMachineKey(
      { teamId: team.id, instanceId: row.instance.id, key: stored.key, view: { kind: 'list' } },
      options.openTeam
    );
    if (!(machineKey && (await resolveKeyFingerprint(machineKey)) === row.instance.fingerprint)) continue;
    const device = await enroll(row, machineKey, stored.key, options);
    if (device) return device;
  }
  return null;
}

export async function admitTeamMachines(rows: MachineRow[], options: TeamAdmitOptions) {
  const candidates = rows.filter(
    (row) => row.instance.role === 'member' && !row.device && row.instance.online
  );
  if (candidates.length === 0) return rows;
  let teams: RemoteTeam[];
  try {
    teams = await options.dashboard.listTeams();
  } catch {
    return rows;
  }
  return Promise.all(
    rows.map(async (row) => {
      if (!candidates.includes(row)) return row;
      const device = await admitMachine(row, teams, options);
      return device ? { ...row, device } : row;
    })
  );
}
