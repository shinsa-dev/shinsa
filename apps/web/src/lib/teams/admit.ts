import { type RemoteTeam, resolveKeyFingerprint } from '@shinsa/core';
import { Clock, Effect, Option, Schema } from 'effect';
import { openRemoteChannel } from '@/lib/remote/channel.ts';
import type { DashboardClient } from '@/lib/remote/dashboard.ts';
import { createDeviceKeys, type DeviceStore } from '@/lib/remote/devices.ts';
import type { MachineRow } from '@/lib/remote/machines.ts';
import type { ChannelOptions, RemoteChannel } from '@/lib/remote/remote-channel/schema.ts';
import type { EnrolledDevice } from '@/lib/remote/schema.ts';
import { runApp } from '@/lib/runtime/app.ts';
import { openTeamChannel } from './channel.ts';
import { type StoredTeamKey, TeamGrantView, type TeamMachineGrant } from './schema.ts';
import type { TeamChannelHandlers, TeamChannelTarget } from './team-socket/schema.ts';

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

const decodeGrantView = Schema.decodeUnknownOption(TeamGrantView);

export function readTeamMachineGrant(target: TeamChannelTarget, open: OpenTeam = openTeamChannel) {
  return Effect.callback<TeamMachineGrant | null>((resume) => {
    let done = false;
    let stop: (() => void) | null = null;
    const finish = (found: TeamMachineGrant | null) => {
      if (done) return;
      done = true;
      resume(Effect.succeed(found));
      stop?.();
    };
    stop = open(target, {
      onMessage: (message) => {
        if (message.t !== 'view') return;
        const view = Option.getOrNull(decodeGrantView(message.data));
        finish(view?.machineKey && view.grant ? { machineKey: view.machineKey, grant: view.grant } : null);
      },
      onEnd: () => finish(null),
    });
    if (done) stop();
    return Effect.sync(() => {
      if (!done) stop?.();
    });
  });
}

export function admitTeamMachines(rows: MachineRow[], options: TeamAdmitOptions) {
  const enroll = Effect.fn('TeamAdmit.enroll')(function* (
    row: MachineRow,
    machineKey: string,
    secret: string
  ) {
    const keys = yield* Effect.promise(() => (options.createKeys ?? createDeviceKeys)());
    const device: EnrolledDevice = {
      instanceId: row.instance.id,
      machineKey,
      keys,
      enrolledAt: options.now?.() ?? (yield* Clock.currentTimeMillis),
    };
    const opened = yield* Effect.option(
      Effect.tryPromise(async () => {
        const { url } = await options.dashboard.requestConnect(row.instance.id);
        const channel = await (options.openChannel ?? openRemoteChannel)({
          url,
          machineKey,
          device: keys,
          enrollSecret: secret,
          name: options.name,
        });
        channel.close();
      })
    );
    if (Option.isNone(opened)) return null;
    yield* Effect.promise(() => options.devices.writeDevice(device));
    return device;
  });

  const admitMachine = Effect.fn('TeamAdmit.admitMachine')(function* (
    row: MachineRow,
    teams: readonly RemoteTeam[]
  ) {
    for (const team of teams) {
      if (!team.machines.some((machine) => machine.id === row.instance.id)) continue;
      const stored = yield* Effect.promise(() => options.selectTeamKey(team.id));
      if (!stored) continue;
      const found = yield* readTeamMachineGrant(
        { teamId: team.id, instanceId: row.instance.id, key: stored.key, view: { kind: 'list' } },
        options.openTeam
      );
      if (!found) continue;
      const fingerprint = yield* resolveKeyFingerprint(found.machineKey);
      if (fingerprint !== row.instance.fingerprint) continue;
      const device = yield* enroll(row, found.machineKey, found.grant);
      if (device) return device;
    }
    return null;
  });

  const candidates = rows.filter(
    (row) => row.instance.role === 'member' && !row.device && row.instance.online
  );
  return runApp(
    Effect.gen(function* () {
      if (candidates.length === 0) return rows;
      const teams = yield* Effect.option(Effect.tryPromise(() => options.dashboard.listTeams()));
      if (Option.isNone(teams)) return rows;
      return yield* Effect.forEach(
        rows,
        (row) =>
          candidates.includes(row)
            ? Effect.map(admitMachine(row, teams.value), (device) => (device ? { ...row, device } : row))
            : Effect.succeed(row),
        { concurrency: 'unbounded' }
      );
    })
  );
}
