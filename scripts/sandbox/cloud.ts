import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { SqliteClient } from '@effect/sql-sqlite-bun';
import { ConfigProvider, Context, Effect, FileSystem, Layer } from 'effect';
import { constVoid } from 'effect/Function';
import { FetchHttpClient } from 'effect/http';
import { makeCloudHandler } from '../../apps/cloud/src/app.ts';
import { Assets, WorkerContext } from '../../apps/cloud/src/http/worker.ts';
import { SQL_NAMES } from '../../apps/cloud/src/store/shared/schema.ts';
import { MACHINE_FEATURES } from '../../packages/core/src/index.ts';

export interface SandboxTunnel {
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
  tunnels: ReadonlyArray<SandboxTunnel>,
  migrations: readonly string[]
) {
  const sqlite = new Database(filename);
  for (const migration of migrations) sqlite.exec(migration);
  sqlite.query('INSERT INTO users (id, login, created_at) VALUES (?, ?, 0)').run(ownerId, 'sandbox');
  for (const tunnel of tunnels)
    sqlite
      .query(
        'INSERT INTO machines (id, owner_id, name, fingerprint, tunnel_id, dns_record_id, machine_token_hash, connect_key, features, online, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0)'
      )
      .run(
        tunnel.id,
        ownerId,
        tunnel.name,
        '',
        tunnel.id,
        tunnel.id,
        tunnel.id,
        tunnel.connectKey,
        JSON.stringify(MACHINE_FEATURES),
        SEEN_UNTIL
      );
  return sqlite;
}

export const createSandboxCloud = Effect.fn('Sandbox.createSandboxCloud')(function* (
  folder: string,
  zone: string,
  ownerId: string,
  tunnels: ReadonlyArray<SandboxTunnel>
) {
  const fs = yield* FileSystem.FileSystem;
  const names = yield* fs.readDirectory(MIGRATIONS);
  const migrations = yield* Effect.forEach(names.filter((name) => name.endsWith('.sql')).sort(), (name) =>
    fs.readFileString(join(MIGRATIONS, name))
  );
  const filename = join(folder, 'cloud.sqlite');
  const sqlite = yield* Effect.try(() => seedDatabase(filename, ownerId, tunnels, migrations));
  const reachTunnel = (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const tunnel = tunnels.find((entry) => url.host === `t-${entry.id}.shinsa.dev`);
    if (!tunnel) return Promise.reject(new Error('No such tunnel.'));
    const headers = new Headers(init?.headers);
    headers.set('cf-connecting-ip', '127.0.0.1');
    return fetch(`http://127.0.0.1:${tunnel.port}${url.pathname}${url.search}`, { ...init, headers });
  };
  const { handler } = makeCloudHandler(
    Layer.mergeAll(
      SqliteClient.layer({ filename, disableWAL: true, ...SQL_NAMES }),
      ConfigProvider.layer(ConfigProvider.fromUnknown({ PREVIEW_ZONE: zone })),
      Layer.succeed(FetchHttpClient.Fetch, reachTunnel as typeof globalThis.fetch),
      Layer.succeed(Assets, { fetch: () => Promise.resolve(new Response('Not found', { status: 404 })) })
    )
  );
  const worker = Context.make(WorkerContext, { waitUntil: constVoid });
  return { sqlite, respond: (request: Request) => handler(request, worker) };
});
