import type { MachineCredentials, RemoteRole } from '@shinsa/core';

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
  signing_key: string | null;
  created_at: number;
}

export interface SharedInstanceRow extends InstanceRow {
  owner_login: string;
  owner_name: string | null;
  owner_avatar_url: string | null;
  role: RemoteRole;
}

export interface MemberRow extends UserRow {
  added_at: number;
}

export interface TeamRow {
  id: string;
  user_id: string;
  name: string;
  created_at: number;
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
  'signing_key',
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

const TEAM_COLUMN_NAMES = ['id', 'user_id', 'name', 'created_at'];

const TEAM_COLUMNS = TEAM_COLUMN_NAMES.join(', ');

const INVITE_TEAM_COLUMNS = TEAM_COLUMN_NAMES.map((column) => `teams.${column}`).join(', ');

export interface SlackWorkspaceRow {
  team_id: string;
  team_name: string;
  bot_user_id: string;
  bot_token: string;
  installed_at: number;
}

export interface SlackLinkRow {
  team_id: string;
  team_name: string;
  slack_user_id: string;
  slack_user_name: string;
  user_id: string;
  instance_id: string;
  linked_at: number;
}

export interface SlackThreadKey {
  teamId: string;
  channelId: string;
  threadTs: string;
}

const SLACK_EVENT_TTL_MS = 24 * 60 * 60 * 1000;

const SLACK_LINK_COLUMNS =
  'slack_links.team_id, slack_workspaces.team_name, slack_links.slack_user_id, slack_links.slack_user_name, slack_links.user_id, slack_links.instance_id, slack_links.linked_at';

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
          `SELECT ${SHARED_INSTANCE_COLUMNS}, CASE WHEN instances.user_id = ?1 THEN 'owner' WHEN instances.id IN (SELECT instance_id FROM instance_members WHERE user_id = ?1) THEN 'member' ELSE 'guest' END AS role FROM instances JOIN users ON users.id = instances.user_id WHERE instances.user_id = ?1 OR instances.id IN (SELECT instance_id FROM instance_members WHERE user_id = ?1) OR instances.id IN (SELECT instance_id FROM instance_guests WHERE user_id = ?1) ORDER BY instances.created_at`
        )
        .bind(userId)
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

    async recordHeartbeat(id: string, localUrl: string, signingKey: string | null, now: number) {
      await db
        .prepare(
          'UPDATE instances SET local_url = ?, online = 1, last_seen_at = ?, signing_key = COALESCE(?, signing_key) WHERE id = ?'
        )
        .bind(localUrl, now, signingKey, id)
        .run();
    },

    async recordOffline(id: string) {
      await db.prepare('UPDATE instances SET online = 0 WHERE id = ?').bind(id).run();
    },

    async removeInstance(id: string) {
      await db.prepare('DELETE FROM instances WHERE id = ?').bind(id).run();
    },

    async replaceInvite(instanceId: string, tokenHash: string, now: number) {
      await db
        .prepare(
          'INSERT INTO instance_invites (instance_id, token_hash, created_at) VALUES (?, ?, ?) ON CONFLICT (instance_id) DO UPDATE SET token_hash = excluded.token_hash, created_at = excluded.created_at'
        )
        .bind(instanceId, tokenHash, now)
        .run();
    },

    async removeInvite(instanceId: string) {
      await db.prepare('DELETE FROM instance_invites WHERE instance_id = ?').bind(instanceId).run();
    },

    async selectInviteInstance(tokenHash: string) {
      const row = await db
        .prepare('SELECT instance_id FROM instance_invites WHERE token_hash = ?')
        .bind(tokenHash)
        .first<{ instance_id: string }>();
      return row?.instance_id ?? null;
    },

    async recordRequester(instanceId: string, userId: string, now: number) {
      await db
        .prepare(
          'INSERT INTO instance_requesters (instance_id, user_id, requested_at) VALUES (?, ?, ?) ON CONFLICT (instance_id, user_id) DO UPDATE SET requested_at = excluded.requested_at'
        )
        .bind(instanceId, userId, now)
        .run();
    },

    async isRequester(instanceId: string, userId: string) {
      const row = await db
        .prepare('SELECT 1 AS found FROM instance_requesters WHERE instance_id = ? AND user_id = ?')
        .bind(instanceId, userId)
        .first<{ found: number }>();
      return row !== null;
    },

    async removeRequester(instanceId: string, userId: string) {
      await db
        .prepare('DELETE FROM instance_requesters WHERE instance_id = ? AND user_id = ?')
        .bind(instanceId, userId)
        .run();
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

    async createHandoff(instanceId: string, tokenHash: string, now: number) {
      await db
        .prepare('INSERT INTO instance_handoffs (token_hash, instance_id, created_at) VALUES (?, ?, ?)')
        .bind(tokenHash, instanceId, now)
        .run();
    },

    async removeHandoff(instanceId: string, tokenHash: string) {
      await db
        .prepare('DELETE FROM instance_handoffs WHERE instance_id = ? AND token_hash = ?')
        .bind(instanceId, tokenHash)
        .run();
    },

    async selectHandoffInstance(tokenHash: string) {
      const row = await db
        .prepare('SELECT instance_id FROM instance_handoffs WHERE token_hash = ?')
        .bind(tokenHash)
        .first<{ instance_id: string }>();
      return row?.instance_id ?? null;
    },

    async createGuest(instanceId: string, userId: string, now: number) {
      await db
        .prepare(
          'INSERT INTO instance_guests (instance_id, user_id, added_at) VALUES (?, ?, ?) ON CONFLICT (instance_id, user_id) DO NOTHING'
        )
        .bind(instanceId, userId, now)
        .run();
    },

    async isGuest(instanceId: string, userId: string) {
      const row = await db
        .prepare('SELECT 1 AS found FROM instance_guests WHERE instance_id = ? AND user_id = ?')
        .bind(instanceId, userId)
        .first<{ found: number }>();
      return row !== null;
    },

    async countGuests(instanceId: string) {
      const row = await db
        .prepare('SELECT COUNT(*) AS total FROM instance_guests WHERE instance_id = ?')
        .bind(instanceId)
        .first<{ total: number }>();
      return row?.total ?? 0;
    },

    async listGuests(instanceId: string) {
      const { results } = await db
        .prepare(
          `SELECT ${USER_COLUMNS}, instance_guests.added_at FROM instance_guests JOIN users ON users.id = instance_guests.user_id WHERE instance_guests.instance_id = ? ORDER BY instance_guests.added_at, users.login`
        )
        .bind(instanceId)
        .all<MemberRow>();
      return results;
    },

    async removeGuest(instanceId: string, userId: string) {
      await db
        .prepare('DELETE FROM instance_guests WHERE instance_id = ? AND user_id = ?')
        .bind(instanceId, userId)
        .run();
    },

    async createTeam(team: TeamRow) {
      await db
        .prepare('INSERT INTO teams (id, user_id, name, created_at) VALUES (?, ?, ?, ?)')
        .bind(team.id, team.user_id, team.name, team.created_at)
        .run();
    },

    async countOwnedTeams(userId: string) {
      const row = await db
        .prepare('SELECT COUNT(*) AS total FROM teams WHERE user_id = ?')
        .bind(userId)
        .first<{ total: number }>();
      return row?.total ?? 0;
    },

    selectTeam(id: string) {
      return db.prepare(`SELECT ${TEAM_COLUMNS} FROM teams WHERE id = ?`).bind(id).first<TeamRow>();
    },

    async listUserTeams(userId: string) {
      const { results } = await db
        .prepare(
          `SELECT ${TEAM_COLUMNS} FROM teams WHERE user_id = ? OR id IN (SELECT team_id FROM team_members WHERE user_id = ?) ORDER BY created_at, id`
        )
        .bind(userId, userId)
        .all<TeamRow>();
      return results;
    },

    async removeTeam(id: string) {
      await db.prepare('DELETE FROM teams WHERE id = ?').bind(id).run();
    },

    async replaceTeamInvite(teamId: string, tokenHash: string, now: number) {
      await db
        .prepare(
          'INSERT INTO team_invites (team_id, token_hash, created_at) VALUES (?, ?, ?) ON CONFLICT (team_id) DO UPDATE SET token_hash = excluded.token_hash, created_at = excluded.created_at'
        )
        .bind(teamId, tokenHash, now)
        .run();
    },

    async removeTeamInvite(teamId: string) {
      await db.prepare('DELETE FROM team_invites WHERE team_id = ?').bind(teamId).run();
    },

    selectInviteTeam(tokenHash: string) {
      return db
        .prepare(
          `SELECT ${INVITE_TEAM_COLUMNS} FROM team_invites JOIN teams ON teams.id = team_invites.team_id WHERE team_invites.token_hash = ?`
        )
        .bind(tokenHash)
        .first<TeamRow>();
    },

    async recordTeamRequester(teamId: string, userId: string, now: number) {
      await db
        .prepare(
          'INSERT INTO team_requesters (team_id, user_id, requested_at) VALUES (?, ?, ?) ON CONFLICT (team_id, user_id) DO UPDATE SET requested_at = excluded.requested_at'
        )
        .bind(teamId, userId, now)
        .run();
    },

    async isTeamRequester(teamId: string, userId: string) {
      const row = await db
        .prepare('SELECT 1 AS found FROM team_requesters WHERE team_id = ? AND user_id = ?')
        .bind(teamId, userId)
        .first<{ found: number }>();
      return row !== null;
    },

    async listTeamRequesters(teamId: string) {
      const { results } = await db
        .prepare(
          `SELECT ${USER_COLUMNS}, team_requesters.requested_at AS added_at FROM team_requesters JOIN users ON users.id = team_requesters.user_id WHERE team_requesters.team_id = ? ORDER BY team_requesters.requested_at, users.login`
        )
        .bind(teamId)
        .all<MemberRow>();
      return results;
    },

    async removeTeamRequester(teamId: string, userId: string) {
      await db
        .prepare('DELETE FROM team_requesters WHERE team_id = ? AND user_id = ?')
        .bind(teamId, userId)
        .run();
    },

    async createTeamMember(teamId: string, userId: string, now: number) {
      await db
        .prepare(
          'INSERT INTO team_members (team_id, user_id, added_at) VALUES (?, ?, ?) ON CONFLICT (team_id, user_id) DO NOTHING'
        )
        .bind(teamId, userId, now)
        .run();
    },

    async isTeamMember(teamId: string, userId: string) {
      const row = await db
        .prepare('SELECT 1 AS found FROM team_members WHERE team_id = ? AND user_id = ?')
        .bind(teamId, userId)
        .first<{ found: number }>();
      return row !== null;
    },

    async sharesTeam(userId: string, otherId: string) {
      const row = await db
        .prepare(
          'SELECT 1 AS found FROM teams WHERE (user_id = ? OR id IN (SELECT team_id FROM team_members WHERE user_id = ?)) AND (user_id = ? OR id IN (SELECT team_id FROM team_members WHERE user_id = ?)) LIMIT 1'
        )
        .bind(userId, userId, otherId, otherId)
        .first<{ found: number }>();
      return row !== null;
    },

    async countTeamMembers(teamId: string) {
      const row = await db
        .prepare('SELECT COUNT(*) AS total FROM team_members WHERE team_id = ?')
        .bind(teamId)
        .first<{ total: number }>();
      return row?.total ?? 0;
    },

    async listTeamMembers(teamId: string) {
      const { results } = await db
        .prepare(
          `SELECT ${USER_COLUMNS}, team_members.added_at FROM team_members JOIN users ON users.id = team_members.user_id WHERE team_members.team_id = ? ORDER BY team_members.added_at, users.login`
        )
        .bind(teamId)
        .all<MemberRow>();
      return results;
    },

    async removeTeamMember(teamId: string, userId: string) {
      await db
        .prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?')
        .bind(teamId, userId)
        .run();
    },

    async listTeamInstances(teamId: string) {
      const { results } = await db
        .prepare(
          `SELECT ${INSTANCE_COLUMNS} FROM instances WHERE user_id IN (SELECT user_id FROM teams WHERE id = ? UNION SELECT user_id FROM team_members WHERE team_id = ?) ORDER BY created_at, id`
        )
        .bind(teamId, teamId)
        .all<InstanceRow>();
      return results;
    },

    async upsertSlackWorkspace(row: SlackWorkspaceRow) {
      await db
        .prepare(
          'INSERT INTO slack_workspaces (team_id, team_name, bot_user_id, bot_token, installed_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (team_id) DO UPDATE SET team_name = excluded.team_name, bot_user_id = excluded.bot_user_id, bot_token = excluded.bot_token, installed_at = excluded.installed_at'
        )
        .bind(row.team_id, row.team_name, row.bot_user_id, row.bot_token, row.installed_at)
        .run();
    },

    selectSlackWorkspace(teamId: string) {
      return db
        .prepare(
          'SELECT team_id, team_name, bot_user_id, bot_token, installed_at FROM slack_workspaces WHERE team_id = ?'
        )
        .bind(teamId)
        .first<SlackWorkspaceRow>();
    },

    async removeSlackWorkspace(teamId: string) {
      await db.prepare('DELETE FROM slack_workspaces WHERE team_id = ?').bind(teamId).run();
    },

    async upsertSlackLink(row: Omit<SlackLinkRow, 'team_name'>) {
      await db
        .prepare(
          'INSERT INTO slack_links (team_id, slack_user_id, slack_user_name, user_id, instance_id, linked_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (team_id, slack_user_id) DO UPDATE SET slack_user_name = excluded.slack_user_name, user_id = excluded.user_id, instance_id = excluded.instance_id, linked_at = excluded.linked_at'
        )
        .bind(
          row.team_id,
          row.slack_user_id,
          row.slack_user_name,
          row.user_id,
          row.instance_id,
          row.linked_at
        )
        .run();
    },

    selectSlackLink(teamId: string, slackUserId: string) {
      return db
        .prepare(
          `SELECT ${SLACK_LINK_COLUMNS} FROM slack_links JOIN slack_workspaces ON slack_workspaces.team_id = slack_links.team_id WHERE slack_links.team_id = ? AND slack_links.slack_user_id = ?`
        )
        .bind(teamId, slackUserId)
        .first<SlackLinkRow>();
    },

    async listInstanceSlackLinks(instanceId: string) {
      const { results } = await db
        .prepare(
          `SELECT ${SLACK_LINK_COLUMNS} FROM slack_links JOIN slack_workspaces ON slack_workspaces.team_id = slack_links.team_id WHERE slack_links.instance_id = ? ORDER BY slack_links.linked_at`
        )
        .bind(instanceId)
        .all<SlackLinkRow>();
      return results;
    },

    async removeInstanceSlackLinks(instanceId: string) {
      await db.prepare('DELETE FROM slack_links WHERE instance_id = ?').bind(instanceId).run();
    },

    async recordSlackThread(thread: SlackThreadKey, instanceId: string, now: number) {
      await db
        .prepare(
          'INSERT INTO slack_threads (team_id, channel_id, thread_ts, instance_id, forwarded_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET forwarded_at = excluded.forwarded_at'
        )
        .bind(thread.teamId, thread.channelId, thread.threadTs, instanceId, now)
        .run();
    },

    async hasSlackThread(thread: SlackThreadKey, instanceId: string) {
      const row = await db
        .prepare(
          'SELECT 1 AS found FROM slack_threads WHERE team_id = ? AND channel_id = ? AND thread_ts = ? AND instance_id = ?'
        )
        .bind(thread.teamId, thread.channelId, thread.threadTs, instanceId)
        .first<{ found: number }>();
      return row !== null;
    },

    async recordSlackPost(teamId: string, channelId: string, ts: string, instanceId: string) {
      await db
        .prepare(
          'INSERT OR IGNORE INTO slack_posts (team_id, channel_id, ts, instance_id) VALUES (?, ?, ?, ?)'
        )
        .bind(teamId, channelId, ts, instanceId)
        .run();
    },

    async hasSlackPost(teamId: string, channelId: string, ts: string, instanceId: string) {
      const row = await db
        .prepare(
          'SELECT 1 AS found FROM slack_posts WHERE team_id = ? AND channel_id = ? AND ts = ? AND instance_id = ?'
        )
        .bind(teamId, channelId, ts, instanceId)
        .first<{ found: number }>();
      return row !== null;
    },

    async recordSlackEvent(eventId: string, now: number) {
      await db
        .prepare('DELETE FROM slack_events WHERE received_at <= ?')
        .bind(now - SLACK_EVENT_TTL_MS)
        .run();
      const row = await db
        .prepare(
          'INSERT INTO slack_events (event_id, received_at) VALUES (?, ?) ON CONFLICT (event_id) DO NOTHING RETURNING event_id'
        )
        .bind(eventId, now)
        .first<{ event_id: string }>();
      return row !== null;
    },
  };
}

export type CloudStore = ReturnType<typeof createStore>;
