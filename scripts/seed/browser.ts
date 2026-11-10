import { join } from 'node:path';
import { SqliteClient } from '@effect/sql-sqlite-bun';
import { Effect, FileSystem } from 'effect';
import { SqlClient } from 'effect/sql';
import { BROWSER_DIR } from '../../apps/engine/src/config/schema.ts';

interface SeedCookie {
  readonly host: string;
  readonly name: string;
  readonly httpOnly: boolean;
}

const session = (host: string, name: string): SeedCookie => ({ host, name, httpOnly: true });

const tracker = (host: string, name: string): SeedCookie => ({ host, name, httpOnly: false });

const SEED_BROWSER_COOKIES: Readonly<Record<string, ReadonlyArray<SeedCookie>>> = {
  'project-superwall': [
    session('.superwall.com', 'wos-session'),
    session('superwall.com', '__Host-csrf'),
    session('.github.com', 'user_session'),
    session('github.com', '_gh_sess'),
    session('.vercel.com', 'authorization'),
    session('dashboard.stripe.com', '__Host-session'),
    tracker('.stripe.com', '__stripe_mid'),
    tracker('.google-analytics.com', '_ga'),
  ],
  'project-basket': [session('.github.com', 'user_session'), session('.linear.app', 'session')],
};

const COOKIE_TABLE = `CREATE TABLE cookies (host_key TEXT NOT NULL, top_frame_site_key TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL, value TEXT NOT NULL DEFAULT '', encrypted_value BLOB NOT NULL DEFAULT x'',
  path TEXT NOT NULL DEFAULT '/', expires_utc INTEGER NOT NULL DEFAULT 0, is_secure INTEGER NOT NULL DEFAULT 1,
  is_httponly INTEGER NOT NULL, samesite INTEGER NOT NULL DEFAULT 1)`;

const writeCookieFile = (file: string, cookies: ReadonlyArray<SeedCookie>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql.unsafe(COOKIE_TABLE);
    for (const cookie of cookies)
      yield* sql`INSERT INTO cookies (host_key, name, is_httponly) VALUES (${cookie.host}, ${cookie.name}, ${cookie.httpOnly ? 1 : 0})`;
  }).pipe(Effect.provide(SqliteClient.layer({ filename: file, disableWAL: true })));

export const writeSeedBrowsers = Effect.fn('writeSeedBrowsers')(function* (data: string) {
  const fs = yield* FileSystem.FileSystem;
  for (const [projectId, cookies] of Object.entries(SEED_BROWSER_COOKIES)) {
    const profile = join(data, BROWSER_DIR, projectId, 'Default');
    yield* fs.makeDirectory(profile, { recursive: true });
    yield* writeCookieFile(join(profile, 'Cookies'), cookies);
  }
});
