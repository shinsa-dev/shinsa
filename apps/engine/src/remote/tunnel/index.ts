import type { MachineCredentials, RemoteAccess, RemoteMember, RemoteTeam, TunnelStatus } from '@shinsa/core';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { JsonLogger } from '../../log/service.ts';
import type { RemoteControl } from '../client/index.ts';
import { RemoteClient } from '../client/service.ts';
import type { TunnelConnector } from '../connector/service.ts';
import type { HealthCheck } from '../health/schema.ts';
import { TunnelHealth } from '../health/service.ts';
import { TunnelMachine } from './schema.ts';
import { TunnelSupervisor } from './service.ts';

export type TunnelConnectorLayer = Layer.Layer<TunnelConnector>;

export type TunnelPing = HealthCheck['check'];

export interface TunnelOptions {
  control: RemoteControl;
  connector: TunnelConnectorLayer;
  ping?: TunnelPing | undefined;
  version: string;
  localUrl: () => string;
  signingKey: () => Promise<string>;
  guestRevision: () => number;
  guests: () => RemoteMember[];
  onAccess: (access: RemoteAccess, guests: RemoteMember[]) => void;
  onTeams: (teams: RemoteTeam[]) => void;
  onStatus: (status: TunnelStatus) => void;
  onRevoked: () => void;
}

export class Tunnel {
  readonly #runtime: ManagedRuntime.ManagedRuntime<TunnelSupervisor, never>;

  constructor(options: TunnelOptions) {
    const machine = Layer.effect(
      TunnelMachine,
      RemoteClient.use((client) =>
        Effect.succeed(
          TunnelMachine.of({
            version: options.version,
            localUrl: Effect.sync(options.localUrl),
            signingKey: Effect.promise(options.signingKey),
            heartbeat: (token, request) =>
              Effect.suspend(() => {
                const revision = options.guestRevision();
                return client.machine
                  .heartbeat(token, request)
                  .pipe(
                    Effect.map((answer) =>
                      revision === options.guestRevision() ? answer : { ...answer, guests: options.guests() }
                    )
                  );
              }),
            recordAccess: (access, guests) => Effect.sync(() => options.onAccess(access, guests)),
            recordTeams: (teams) => Effect.sync(() => options.onTeams(teams)),
            recordStatus: (status) => Effect.sync(() => options.onStatus(status)),
            forget: Effect.sync(options.onRevoked),
          })
        )
      )
    );
    const health = options.ping
      ? Layer.succeed(TunnelHealth, { check: options.ping })
      : TunnelHealth.layer.pipe(Layer.provide(FetchHttpClient.layer));
    this.#runtime = ManagedRuntime.make(
      TunnelSupervisor.layer.pipe(
        Layer.provide(Layer.mergeAll(machine, options.connector, health)),
        Layer.provide(options.control.layer),
        Layer.provideMerge(JsonLogger)
      )
    );
  }

  start(credentials: MachineCredentials) {
    this.#runtime.runFork(TunnelSupervisor.use((tunnel) => tunnel.start(credentials)));
  }

  requestHeartbeat() {
    return this.#runtime.runPromise(TunnelSupervisor.use((tunnel) => tunnel.heartbeat));
  }

  stop() {
    return this.#runtime.runPromise(TunnelSupervisor.use((tunnel) => tunnel.stop));
  }
}
