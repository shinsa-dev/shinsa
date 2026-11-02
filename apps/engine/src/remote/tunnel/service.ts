import type { MachineCredentials, TunnelStatus } from '@shinsa/core';
import type { Revoked } from '@shinsa/core/remote/errors';
import { Context, Effect, FiberHandle, Layer, Redacted, Ref } from 'effect';
import { describeError } from '../../log/redact.ts';
import { RemoteClient } from '../client/service.ts';
import { TunnelConnector } from '../connector/service.ts';
import { TunnelHealth } from '../health/service.ts';
import { readAccess, readGuests, readTeams } from '../store.ts';
import {
  FAILED_PINGS_BEFORE_RESTART,
  HEARTBEAT_EVERY_PINGS,
  PING_INTERVAL,
  PING_SCHEDULE,
  QUICK_RESTART,
  RESTART_SCHEDULE,
  TunnelDropped,
  TunnelMachine,
} from './schema.ts';

export class TunnelSupervisor extends Context.Service<
  TunnelSupervisor,
  {
    readonly status: Effect.Effect<TunnelStatus>;
    start(credentials: MachineCredentials): Effect.Effect<void>;
    readonly stop: Effect.Effect<void>;
    readonly heartbeat: Effect.Effect<void>;
  }
>()('shinsa/engine/remote/tunnel/TunnelSupervisor') {
  static readonly layer = Layer.effect(
    TunnelSupervisor,
    Effect.gen(function* () {
      const machine = yield* TunnelMachine;
      const connector = yield* TunnelConnector;
      const health = yield* TunnelHealth;
      const client = yield* RemoteClient;
      const status = yield* Ref.make<TunnelStatus>('off');
      const current = yield* Ref.make<MachineCredentials | null>(null);
      const running = yield* FiberHandle.make<void>();

      const updateStatus = Effect.fnUntraced(function* (next: TunnelStatus) {
        const before = yield* Ref.getAndSet(status, next);
        if (before !== next) yield* machine.recordStatus(next);
      });

      const beat = Effect.fn('TunnelSupervisor.beat')(function* (credentials: MachineCredentials) {
        const signingKey = yield* machine.signingKey;
        const localUrl = yield* machine.localUrl;
        const answer = yield* machine
          .heartbeat(Redacted.make(credentials.machineToken), {
            localUrl,
            version: machine.version,
            ...(signingKey ? { signingKey } : {}),
          })
          .pipe(
            Effect.catchIf(
              (error): error is Exclude<typeof error, Revoked> => error._tag !== 'Revoked',
              (error) =>
                Effect.logWarning('[Remote] The heartbeat failed').pipe(
                  Effect.annotateLogs({ error: describeError(error) }),
                  Effect.as(null)
                )
            )
          );
        if (!answer) return;
        const access = readAccess(answer);
        const teams = readTeams(answer.teams);
        if (access) yield* machine.recordAccess(access, readGuests(answer));
        if (teams) yield* machine.recordTeams(teams);
      });

      const revoke = Effect.gen(function* () {
        yield* Effect.logWarning('[Remote] Shinsa Cloud removed this machine; remote access is off');
        yield* Ref.set(current, null);
        yield* updateStatus('revoked');
        yield* machine.forget;
      });

      const session = Effect.fn('TunnelSupervisor.session')(function* (credentials: MachineCredentials) {
        const connection = yield* connector
          .open(Redacted.make(credentials.tunnelToken), yield* machine.localUrl)
          .pipe(
            Effect.tapError((error) =>
              Effect.logWarning('[Remote] The tunnel did not connect').pipe(
                Effect.annotateLogs({ error: error.message })
              )
            ),
            Effect.mapError((error) => new TunnelDropped({ healthy: false, message: error.message }))
          );
        yield* beat(credentials);
        yield* updateStatus('connected');
        const healthy = yield* Ref.make(false);
        const failed = yield* Ref.make(0);
        const pings = yield* Ref.make(0);
        const ping = Effect.gen(function* () {
          const ok = yield* health.check(`https://${credentials.tunnelHost}/health`);
          if (!ok) {
            const failures = yield* Ref.updateAndGet(failed, (count) => count + 1);
            if (failures < FAILED_PINGS_BEFORE_RESTART) return;
            return yield* new TunnelDropped({
              healthy: yield* Ref.get(healthy),
              message: 'The tunnel stopped answering its health check.',
            });
          }
          yield* Ref.set(failed, 0);
          yield* Ref.set(healthy, true);
          const count = yield* Ref.updateAndGet(pings, (total) => total + 1);
          if (count % HEARTBEAT_EVERY_PINGS === 0) yield* beat(credentials);
        });
        const exited = connection.exited.pipe(
          Effect.andThen(Effect.logWarning('[Remote] The tunnel stopped; starting it again')),
          Effect.andThen(Ref.get(healthy)),
          Effect.flatMap((wasHealthy) =>
            Effect.fail(new TunnelDropped({ healthy: wasHealthy, message: 'cloudflared stopped.' }))
          )
        );
        const watch = Effect.sleep(PING_INTERVAL).pipe(Effect.andThen(Effect.repeat(ping, PING_SCHEDULE)));
        yield* Effect.raceFirst(watch, exited);
      }, Effect.scoped);

      const supervise = (credentials: MachineCredentials) =>
        session(credentials).pipe(
          Effect.tapError((error) =>
            error._tag === 'TunnelDropped' ? updateStatus('reconnecting') : Effect.void
          ),
          Effect.retry({
            schedule: RESTART_SCHEDULE,
            while: (error) => error._tag === 'TunnelDropped' && !error.healthy,
          }),
          Effect.catchTag('TunnelDropped', () => Effect.sleep(QUICK_RESTART)),
          Effect.forever,
          Effect.catchTag('Revoked', () => revoke)
        );

      const start = Effect.fn('TunnelSupervisor.start')(function* (credentials: MachineCredentials) {
        yield* FiberHandle.clear(running);
        yield* Ref.set(current, credentials);
        yield* updateStatus('starting');
        yield* FiberHandle.run(running, supervise(credentials));
      });

      const stop = Effect.gen(function* () {
        const credentials = yield* Ref.get(current);
        const before = yield* Ref.get(status);
        yield* FiberHandle.clear(running);
        yield* Ref.set(current, null);
        yield* updateStatus('off');
        if (!credentials || before === 'off' || before === 'revoked') return;
        yield* client.machine
          .offline(Redacted.make(credentials.machineToken))
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning('[Remote] Could not mark this machine offline').pipe(
                Effect.annotateLogs({ error: describeError(error) })
              )
            )
          );
      }).pipe(Effect.withSpan('TunnelSupervisor.stop'));

      const heartbeat = Effect.gen(function* () {
        const credentials = yield* Ref.get(current);
        if (!credentials) return;
        yield* beat(credentials).pipe(
          Effect.catchTag('Revoked', () => FiberHandle.clear(running).pipe(Effect.andThen(revoke)))
        );
      }).pipe(Effect.withSpan('TunnelSupervisor.heartbeat'));

      return TunnelSupervisor.of({ status: Ref.get(status), start, stop, heartbeat });
    })
  );
}
