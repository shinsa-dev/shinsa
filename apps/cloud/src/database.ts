import type { MachineCredentials } from '@shinsa/core';

export interface DatabaseStatement {
  bind: (...values: unknown[]) => DatabaseStatement;
  first: <T>() => Promise<T | null>;
  all: <T>() => Promise<{ results: T[] }>;
  run: () => Promise<unknown>;
}

export interface Database {
  prepare: (sql: string) => DatabaseStatement;
}

export interface UserRow {
  id: string;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

export interface SignInCodeRow {
  user_id: string;
  code_challenge: string;
  expires_at: number;
}

export interface InstanceRow {
  id: string;
  user_id: string;
  name: string;
  fingerprint: string;
  tunnel_id: string;
  dns_record_id: string;
  connect_key: string;
  local_url: string | null;
  online: number;
  last_seen_at: number | null;
  created_at: number;
}

export interface SharedInstanceRow extends InstanceRow {
  owner_login: string;
  owner_name: string | null;
  owner_avatar_url: string | null;
}

export interface InviteRow {
  instance_id: string;
  expires_at: number;
  claimed_by: string | null;
}

export interface MemberRow extends UserRow {
  added_at: number;
}

export interface PairSessionRow {
  claim_code: string;
  poll_secret_hash: string;
  name: string;
  public_key: string;
  version: string;
  expires_at: number;
  credentials: string | null;
  owner: string | null;
}

export interface NewInstance {
  id: string;
  userId: string;
  name: string;
  fingerprint: string;
  tunnelId: string;
  dnsRecordId: string;
  machineTokenHash: string;
  connectKey: string;
  createdAt: number;
}

const INSTANCE_COLUMN_NAMES = [
  'id',
  'user_id',
  'name',
  'fingerprint',
  'tunnel_id',
  'dns_record_id',
  'connect_key',
  'local_url',
  'online',
  'last_seen_at',
  'created_at',
];

const INSTANCE_COLUMNS = INSTANCE_COLUMN_NAMES.join(', ');

const SHARED_INSTANCE_COLUMNS = [
  ...INSTANCE_COLUMN_NAMES.map((column) => `instances.${column}`),
  'users.login AS owner_login',
  'users.name AS owner_name',
  'users.avatar_url AS owner_avatar_url',
].join(', ');

const USER_COLUMNS = 'users.id, users.login, users.name, users.avatar_url';

export function createStore(db: Database) {
  return {
    async upsertUser(user: UserRow, now: number) {
      await db
        .prepare(
          'INSERT INTO users (id, login, name, avatar_url, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET login = excluded.login, name = excluded.name, avatar_url = excluded.avatar_url'
        )
        .bind(user.id, user.login, user.name, user.avatar_url, now)
        .run();
    },

    async createSession(tokenHash: string, userId: string, expiresAt: number) {
      await db
        .prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
        .bind(tokenHash, userId, expiresAt)
        .run();
    },

    selectSessionUser(tokenHash: string, now: number) {
      return db
        .prepare(
          `SELECT ${USER_COLUMNS} FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?`
        )
        .bind(tokenHash, now)
        .first<UserRow>();
    },

    async removeSession(tokenHash: string) {
      await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    },

    selectUser(id: string) {
      return db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).bind(id).first<UserRow>();
    },

    async createSignInCode(codeHash: string, row: SignInCodeRow, now: number) {
      await db.prepare('DELETE FROM sign_in_codes WHERE expires_at <= ?').bind(now).run();
      await db
        .prepare(
          'INSERT INTO sign_in_codes (code_hash, user_id, code_challenge, expires_at) VALUES (?, ?, ?, ?)'
        )
        .bind(codeHash, row.user_id, row.code_challenge, row.expires_at)
        .run();
    },

    takeSignInCode(codeHash: string) {
      return db
        .prepare(
          'DELETE FROM sign_in_codes WHERE code_hash = ? RETURNING user_id, code_challenge, expires_at'
        )
        .bind(codeHash)
        .first<SignInCodeRow>();
    },

    async createPairSession(row: Omit<PairSessionRow, 'credentials' | 'owner'>, clientIp: string) {
      await db
        .prepare(
          'INSERT INTO pair_sessions (claim_code, poll_secret_hash, name, public_key, version, client_ip, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .bind(
          row.claim_code,
          row.poll_secret_hash,
          row.name,
          row.public_key,
          row.version,
          clientIp,
          row.expires_at
        )
        .run();
    },

    async removeExpiredPairSessions(now: number) {
      await db.prepare('DELETE FROM pair_sessions WHERE expires_at <= ?').bind(now).run();
    },

    async countPairSessionsFrom(clientIp: string) {
      const row = await db
        .prepare('SELECT COUNT(*) AS count FROM pair_sessions WHERE client_ip = ?')
        .bind(clientIp)
        .first<{ count: number }>();
      return row?.count ?? 0;
    },

    selectPairSession(claimCode: string) {
      return db
        .prepare(
          'SELECT claim_code, poll_secret_hash, name, public_key, version, expires_at, credentials, owner FROM pair_sessions WHERE claim_code = ?'
        )
        .bind(claimCode)
        .first<PairSessionRow>();
    },

    async reservePairClaim(claimCode: string, owner: string) {
      const row = await db
        .prepare(
          'UPDATE pair_sessions SET owner = ? WHERE claim_code = ? AND owner IS NULL RETURNING claim_code'
        )
        .bind(owner, claimCode)
        .first<{ claim_code: string }>();
      return row !== null;
    },

    async releasePairClaim(claimCode: string) {
      await db
        .prepare('UPDATE pair_sessions SET owner = NULL WHERE claim_code = ? AND credentials IS NULL')
        .bind(claimCode)
        .run();
    },

    async recordPairClaim(claimCode: string, credentials: MachineCredentials) {
      await db
        .prepare('UPDATE pair_sessions SET credentials = ? WHERE claim_code = ?')
        .bind(JSON.stringify(credentials), claimCode)
        .run();
    },

    async removePairSession(claimCode: string) {
      await db.prepare('DELETE FROM pair_sessions WHERE claim_code = ?').bind(claimCode).run();
    },

    async createInstance(instance: NewInstance) {
      await db
        .prepare(
          'INSERT INTO instances (id, user_id, name, fingerprint, tunnel_id, dns_record_id, machine_token_hash, connect_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .bind(
          instance.id,
          instance.userId,
          instance.name,
          instance.fingerprint,
          instance.tunnelId,
          instance.dnsRecordId,
          instance.machineTokenHash,
          instance.connectKey,
          instance.createdAt
        )
        .run();
    },

    async countInstances() {
      const row = await db.prepare('SELECT COUNT(*) AS total FROM instances').first<{ total: number }>();
      return row?.total ?? 0;
    },

    async countOwnedInstances(userId: string) {
      const row = await db
        .prepare('SELECT COUNT(*) AS total FROM instances WHERE user_id = ?')
        .bind(userId)
        .first<{ total: number }>();
      return row?.total ?? 0;
    },

    async listUserInstances(userId: string) {
      const { results } = await db
        .prepare(
          `SELECT ${SHARED_INSTANCE_COLUMNS} FROM instances JOIN users ON users.id = instances.user_id WHERE instances.user_id = ? OR instances.id IN (SELECT instance_id FROM instance_members WHERE user_id = ?) ORDER BY instances.created_at`
        )
        .bind(userId, userId)
        .all<SharedInstanceRow>();
      return results;
    },

    selectInstance(id: string) {
      return db
        .prepare(`SELECT ${INSTANCE_COLUMNS} FROM instances WHERE id = ?`)
        .bind(id)
        .first<InstanceRow>();
    },

    selectMachineInstance(machineTokenHash: string) {
      return db
        .prepare(`SELECT ${INSTANCE_COLUMNS} FROM instances WHERE machine_token_hash = ?`)
        .bind(machineTokenHash)
        .first<InstanceRow>();
    },

    async recordHeartbeat(id: string, localUrl: string, now: number) {
      await db
        .prepare('UPDATE instances SET local_url = ?, online = 1, last_seen_at = ? WHERE id = ?')
        .bind(localUrl, now, id)
        .run();
    },

    async recordOffline(id: string) {
      await db.prepare('UPDATE instances SET online = 0 WHERE id = ?').bind(id).run();
    },

    async removeInstance(id: string) {
      await db.prepare('DELETE FROM instances WHERE id = ?').bind(id).run();
    },

    async createInvite(tokenHash: string, instanceId: string, expiresAt: number) {
      await db
        .prepare('INSERT INTO instance_invites (token_hash, instance_id, expires_at) VALUES (?, ?, ?)')
        .bind(tokenHash, instanceId, expiresAt)
        .run();
    },

    async removeExpiredInvites(now: number) {
      await db.prepare('DELETE FROM instance_invites WHERE expires_at <= ?').bind(now).run();
    },

    async countPendingInvites(instanceId: string) {
      const row = await db
        .prepare(
          'SELECT COUNT(*) AS total FROM instance_invites WHERE instance_id = ? AND claimed_by IS NULL'
        )
        .bind(instanceId)
        .first<{ total: number }>();
      return row?.total ?? 0;
    },

    selectInvite(tokenHash: string) {
      return db
        .prepare('SELECT instance_id, expires_at, claimed_by FROM instance_invites WHERE token_hash = ?')
        .bind(tokenHash)
        .first<InviteRow>();
    },

    async claimInvite(tokenHash: string, userId: string, now: number) {
      const row = await db
        .prepare(
          'UPDATE instance_invites SET claimed_by = ? WHERE token_hash = ? AND claimed_by IS NULL AND expires_at > ? RETURNING token_hash'
        )
        .bind(userId, tokenHash, now)
        .first<{ token_hash: string }>();
      return row !== null;
    },

    async createMember(instanceId: string, userId: string, now: number) {
      await db
        .prepare(
          'INSERT INTO instance_members (instance_id, user_id, added_at) VALUES (?, ?, ?) ON CONFLICT (instance_id, user_id) DO NOTHING'
        )
        .bind(instanceId, userId, now)
        .run();
    },

    async isMember(instanceId: string, userId: string) {
      const row = await db
        .prepare('SELECT 1 AS found FROM instance_members WHERE instance_id = ? AND user_id = ?')
        .bind(instanceId, userId)
        .first<{ found: number }>();
      return row !== null;
    },

    async countMembers(instanceId: string) {
      const row = await db
        .prepare('SELECT COUNT(*) AS total FROM instance_members WHERE instance_id = ?')
        .bind(instanceId)
        .first<{ total: number }>();
      return row?.total ?? 0;
    },

    async listMembers(instanceId: string) {
      const { results } = await db
        .prepare(
          `SELECT ${USER_COLUMNS}, instance_members.added_at FROM instance_members JOIN users ON users.id = instance_members.user_id WHERE instance_members.instance_id = ? ORDER BY instance_members.added_at, users.login`
        )
        .bind(instanceId)
        .all<MemberRow>();
      return results;
    },

    async removeMember(instanceId: string, userId: string) {
      await db
        .prepare('DELETE FROM instance_members WHERE instance_id = ? AND user_id = ?')
        .bind(instanceId, userId)
        .run();
    },
  };
}

export type CloudStore = ReturnType<typeof createStore>;
