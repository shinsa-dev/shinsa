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

CREATE TABLE instances (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  tunnel_id TEXT NOT NULL,
  dns_record_id TEXT NOT NULL,
  machine_token_hash TEXT NOT NULL UNIQUE,
  connect_key TEXT NOT NULL,
  signing_key TEXT,
  features TEXT NOT NULL,
  local_url TEXT,
  online INTEGER NOT NULL DEFAULT 0 CHECK (online IN (0, 1)),
  last_seen_at INTEGER,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX instances_user ON instances (user_id, created_at);

CREATE TABLE pair_sessions (
  claim_code TEXT PRIMARY KEY,
  poll_secret_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  public_key TEXT NOT NULL,
  features TEXT NOT NULL,
  client_ip TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  credentials TEXT,
  owner TEXT
) STRICT;

CREATE INDEX pair_sessions_ip ON pair_sessions (client_ip);

CREATE INDEX pair_sessions_expiry ON pair_sessions (expires_at);

CREATE TABLE instance_invites (
  instance_id TEXT PRIMARY KEY REFERENCES instances (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE instance_handoffs (
  token_hash TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL REFERENCES instances (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

CREATE INDEX instance_handoffs_instance ON instance_handoffs (instance_id);

CREATE TABLE instance_requesters (
  instance_id TEXT NOT NULL REFERENCES instances (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  requested_at INTEGER NOT NULL,
  PRIMARY KEY (instance_id, user_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX instance_requesters_user ON instance_requesters (user_id);

CREATE TABLE instance_members (
  instance_id TEXT NOT NULL REFERENCES instances (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (instance_id, user_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX instance_members_user ON instance_members (user_id);

CREATE TABLE instance_guests (
  instance_id TEXT NOT NULL REFERENCES instances (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (instance_id, user_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX instance_guests_user ON instance_guests (user_id);

CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  scopes TEXT,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX teams_user ON teams (user_id);

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
  scopes TEXT,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, user_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX team_members_user ON team_members (user_id);

CREATE TABLE slack_workspaces (
  team_id TEXT PRIMARY KEY,
  team_name TEXT NOT NULL,
  bot_user_id TEXT NOT NULL,
  bot_token TEXT NOT NULL,
  installed_at INTEGER NOT NULL
) STRICT;

CREATE TABLE slack_links (
  team_id TEXT NOT NULL REFERENCES slack_workspaces (team_id) ON DELETE CASCADE,
  slack_user_id TEXT NOT NULL,
  slack_user_name TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  instance_id TEXT NOT NULL REFERENCES instances (id) ON DELETE CASCADE,
  linked_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, slack_user_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX slack_links_user ON slack_links (user_id);

CREATE INDEX slack_links_instance ON slack_links (instance_id);

CREATE TABLE slack_threads (
  team_id TEXT NOT NULL REFERENCES slack_workspaces (team_id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  thread_ts TEXT NOT NULL,
  instance_id TEXT NOT NULL REFERENCES instances (id) ON DELETE CASCADE,
  forwarded_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, channel_id, thread_ts, instance_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX slack_threads_instance ON slack_threads (instance_id);

CREATE TABLE slack_posts (
  team_id TEXT NOT NULL REFERENCES slack_workspaces (team_id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  instance_id TEXT NOT NULL REFERENCES instances (id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, channel_id, ts)
) STRICT, WITHOUT ROWID;

CREATE INDEX slack_posts_instance ON slack_posts (instance_id);

CREATE TABLE slack_events (
  event_id TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

CREATE INDEX slack_events_received ON slack_events (received_at);
