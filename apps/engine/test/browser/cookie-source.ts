import { Database } from 'bun:sqlite';
import { createCipheriv, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createCookieKey } from '../../src/browser/cookies/decrypt.ts';
import { COOKIE_IV } from '../../src/browser/cookies/schema.ts';

export const DIA_PASSWORD = 'dia-safe-storage-password';

const CHROMIUM_EPOCH_OFFSET_SECONDS = 11_644_473_600;

export interface SourceCookie {
  readonly host: string;
  readonly name: string;
  readonly value?: string;
  readonly plain?: string;
  readonly path?: string;
  readonly expires?: number | null;
  readonly secure?: boolean;
  readonly httpOnly?: boolean;
  readonly sameSite?: number;
  readonly priority?: number;
  readonly partition?: string;
  readonly signed?: boolean;
}

export function encryptCookieValue(password: string, value: string, host: string, signed = true) {
  const cipher = createCipheriv('aes-128-cbc', createCookieKey(password), COOKIE_IV);
  const digest = signed ? createHash('sha256').update(host).digest() : Buffer.alloc(0);
  return Buffer.concat([
    Buffer.from('v10'),
    cipher.update(Buffer.concat([digest, Buffer.from(value)])),
    cipher.final(),
  ]);
}

export function toChromiumTime(unixSeconds: number) {
  return (unixSeconds + CHROMIUM_EPOCH_OFFSET_SECONDS) * 1_000_000;
}

export function writeCookieDatabase(
  file: string,
  cookies: ReadonlyArray<SourceCookie>,
  options: { readonly wal?: boolean } = {}
) {
  const password = DIA_PASSWORD;
  mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file, { create: true });
  if (options.wal) db.run('PRAGMA journal_mode=WAL');
  db.run(`CREATE TABLE meta(key TEXT, value TEXT)`);
  db.run(`INSERT INTO meta VALUES ('version', '24')`);
  db.run(`CREATE TABLE cookies(creation_utc INTEGER, host_key TEXT, top_frame_site_key TEXT, name TEXT, value TEXT,
    encrypted_value BLOB, path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER,
    last_access_utc INTEGER, has_expires INTEGER, is_persistent INTEGER, priority INTEGER, samesite INTEGER,
    source_scheme INTEGER, source_port INTEGER, last_update_utc INTEGER, source_type INTEGER,
    has_cross_site_ancestor INTEGER)`);
  const insert = db.prepare(
    `INSERT INTO cookies VALUES (0, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?, 2, 443, 0, 0, 0)`
  );
  for (const cookie of cookies) {
    const persistent = cookie.expires !== null;
    insert.run(
      cookie.host,
      cookie.partition ?? '',
      cookie.name,
      cookie.plain ?? '',
      cookie.plain === undefined
        ? encryptCookieValue(password, cookie.value ?? '', cookie.host, cookie.signed ?? true)
        : Buffer.alloc(0),
      cookie.path ?? '/',
      persistent ? toChromiumTime(cookie.expires ?? Math.floor(Date.now() / 1000) + 86_400) : 0,
      cookie.secure === false ? 0 : 1,
      cookie.httpOnly === false ? 0 : 1,
      persistent ? 1 : 0,
      cookie.priority ?? 1,
      cookie.sameSite ?? 1
    );
  }
  if (options.wal) return db;
  db.close();
  return null;
}

export function writeDiaCookies(userHome: string, cookies: ReadonlyArray<SourceCookie>) {
  writeCookieDatabase(join(userHome, 'Library/Application Support/Dia/User Data/Default/Cookies'), cookies);
}
