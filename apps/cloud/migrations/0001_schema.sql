CREATE TABLE users (
  id TEXT PRIMARY KEY,
  login TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

CREATE INDEX sessions_user ON sessions (user_id);

CREATE INDEX sessions_expiry ON sessions (expires_at);

CREATE TABLE sign_in_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

CREATE INDEX sign_in_codes_user ON sign_in_codes (user_id);

CREATE INDEX sign_in_codes_expiry ON sign_in_codes (expires_at);

CREATE TABLE machines (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  tunnel_id TEXT NOT NULL,
  dns_record_id TEXT NOT NULL,
  machine_token_hash TEXT NOT NULL UNIQUE,
  connect_key TEXT NOT NULL,
  signing_key TEXT,
  features TEXT NOT NULL CHECK (json_valid(features)),
  local_url TEXT,
  online INTEGER NOT NULL DEFAULT 0 CHECK (online IN (0, 1)),
  last_seen_at INTEGER,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX machines_owner ON machines (owner_id, created_at);

CREATE TABLE pairings (
  claim_code TEXT PRIMARY KEY,
  poll_secret_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  public_key TEXT NOT NULL,
  features TEXT NOT NULL CHECK (json_valid(features)),
  client_ip TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  credentials TEXT,
  owner TEXT
) STRICT;

CREATE INDEX pairings_ip ON pairings (client_ip);

CREATE INDEX pairings_expiry ON pairings (expires_at);

CREATE TABLE machine_invites (
  machine_id TEXT PRIMARY KEY REFERENCES machines (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE machine_handoffs (
  token_hash TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL REFERENCES machines (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

CREATE INDEX machine_handoffs_machine ON machine_handoffs (machine_id);

CREATE TABLE machine_requesters (
  machine_id TEXT NOT NULL REFERENCES machines (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  requested_at INTEGER NOT NULL,
  PRIMARY KEY (machine_id, user_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX machine_requesters_user ON machine_requesters (user_id);

CREATE TABLE machine_members (
  machine_id TEXT NOT NULL REFERENCES machines (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (machine_id, user_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX machine_members_user ON machine_members (user_id);

CREATE TABLE machine_guests (
  machine_id TEXT NOT NULL REFERENCES machines (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (machine_id, user_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX machine_guests_user ON machine_guests (user_id);

CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  scopes TEXT CHECK (json_valid(scopes)),
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX teams_owner ON teams (owner_id);

CREATE TABLE team_invites (
  team_id TEXT PRIMARY KEY REFERENCES teams (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE team_requesters (
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  requested_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, user_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX team_requesters_user ON team_requesters (user_id);

CREATE TABLE team_members (
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  scopes TEXT CHECK (json_valid(scopes)),
  added_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, user_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX team_members_user ON team_members (user_id);

CREATE TABLE slack_workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  bot_user_id TEXT NOT NULL,
  sealed_bot_token TEXT NOT NULL,
  installed_at INTEGER NOT NULL
) STRICT;

CREATE TABLE slack_links (
  workspace_id TEXT NOT NULL REFERENCES slack_workspaces (id) ON DELETE CASCADE,
  slack_user_id TEXT NOT NULL,
  slack_user_name TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  machine_id TEXT NOT NULL REFERENCES machines (id) ON DELETE CASCADE,
  linked_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, slack_user_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX slack_links_user ON slack_links (user_id);

CREATE INDEX slack_links_machine ON slack_links (machine_id);

CREATE TABLE slack_threads (
  workspace_id TEXT NOT NULL REFERENCES slack_workspaces (id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  thread_ts TEXT NOT NULL,
  machine_id TEXT NOT NULL REFERENCES machines (id) ON DELETE CASCADE,
  forwarded_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, channel_id, thread_ts, machine_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX slack_threads_machine ON slack_threads (machine_id);

CREATE TABLE slack_posts (
  workspace_id TEXT NOT NULL REFERENCES slack_workspaces (id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  machine_id TEXT NOT NULL REFERENCES machines (id) ON DELETE CASCADE,
  PRIMARY KEY (workspace_id, channel_id, ts)
) STRICT, WITHOUT ROWID;

CREATE INDEX slack_posts_machine ON slack_posts (machine_id);

CREATE TABLE slack_events (
  event_id TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

CREATE INDEX slack_events_received ON slack_events (received_at);
