import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { SqliteClient } from '@effect/sql-sqlite-bun';
import { ConfigProvider, Context, Effect, FileSystem, Layer } from 'effect';
import { constVoid } from 'effect/Function';
import { makeCloudHandler } from '../../apps/cloud/src/app.ts';
import { Assets, RelayRooms, WorkerContext } from '../../apps/cloud/src/http/worker.ts';
import {
  RELAY_ADDRESS_HEADER,
  RELAY_INTERNAL_HEADERS,
  RELAY_REFUSALS,
  RELAY_ROLE_HEADER,
  RELAY_ROOM_ORIGIN,
} from '../../apps/cloud/src/relay/schema.ts';
import { SQL_NAMES } from '../../apps/cloud/src/store/shared/schema.ts';
import { MACHINE_FEATURES } from '../../packages/core/src/index.ts';

export interface SandboxMachine {
  readonly id: string;
  readonly name: string;
  readonly port: number;
  readonly connectKey: string;
}

const MIGRATIONS = join(import.meta.dirname, '../../apps/cloud/migrations');

const SEEN_UNTIL = Number.MAX_SAFE_INTEGER;

function seedDatabase(
  filename: string,
  ownerId: string,
  machines: ReadonlyArray<SandboxMachine>,
  migrations: readonly string[]
) {
  const sqlite = new Database(filename);
  for (const migration of migrations) sqlite.exec(migration);
  sqlite.query('INSERT INTO users (id, login, created_at) VALUES (?, ?, 0)').run(ownerId, 'sandbox');
  for (const machine of machines)
    sqlite
      .query(
        'INSERT INTO machines (id, owner_id, name, fingerprint, machine_token_hash, connect_key, features, online, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 0)'
      )
      .run(
        machine.id,
        ownerId,
        machine.name,
        '',
        machine.id,
        machine.connectKey,
        JSON.stringify(MACHINE_FEATURES),
        SEEN_UNTIL
      );
  return sqlite;
}

function refuseRoom() {
  return new Response(RELAY_REFUSALS.offline.text, { status: RELAY_REFUSALS.offline.status });
}

const answerRoom = Effect.fn('Sandbox.answerRoom')(function* (
  machines: ReadonlyArray<SandboxMachine>,
  instanceId: string,
  request: Request
) {
  const machine = machines.find((entry) => entry.id === instanceId);
  if (!machine || request.headers.get(RELAY_ROLE_HEADER) !== 'http') return refuseRoom();
  const headers = new Headers(request.headers);
  for (const name of RELAY_INTERNAL_HEADERS) headers.delete(name);
  headers.set('cf-connecting-ip', request.headers.get(RELAY_ADDRESS_HEADER) ?? '127.0.0.1');
  const path = request.url.slice(RELAY_ROOM_ORIGIN.length);
  const body = request.body ? request.arrayBuffer() : Promise.resolve(null);
  return yield* Effect.tryPromise(async () =>
    fetch(`http://127.0.0.1:${machine.port}${path}`, {
      method: request.method,
      headers,
      body: await body,
      redirect: 'manual',
    })
  ).pipe(Effect.orElseSucceed(refuseRoom));
});

export const createSandboxCloud = Effect.fn('Sandbox.createSandboxCloud')(function* (
  folder: string,
  zone: string,
  ownerId: string,
  machines: ReadonlyArray<SandboxMachine>
) {
  const fs = yield* FileSystem.FileSystem;
  const names = yield* fs.readDirectory(MIGRATIONS);
  const migrations = yield* Effect.forEach(names.filter((name) => name.endsWith('.sql')).sort(), (name) =>
    fs.readFileString(join(MIGRATIONS, name))
  );
  const filename = join(folder, 'cloud.sqlite');
  const sqlite = yield* Effect.try(() => seedDatabase(filename, ownerId, machines, migrations));
  const { handler } = makeCloudHandler(
    Layer.mergeAll(
      SqliteClient.layer({ filename, disableWAL: true, ...SQL_NAMES }),
      ConfigProvider.layer(ConfigProvider.fromUnknown({ PREVIEW_ZONE: zone })),
      Layer.succeed(RelayRooms, {
        fetch: (instanceId, request) => Effect.runPromise(answerRoom(machines, instanceId, request)),
      }),
      Layer.succeed(Assets, { fetch: () => Promise.resolve(new Response('Not found', { status: 404 })) })
    )
  );
  const worker = Context.make(WorkerContext, { waitUntil: constVoid });
  return { sqlite, respond: (request: Request) => handler(request, worker) };
});
