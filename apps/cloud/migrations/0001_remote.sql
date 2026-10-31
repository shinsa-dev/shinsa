CREATE TABLE users (
  id TEXT PRIMARY KEY,
  login TEXT NOT NULL,
  avatar_url TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE instances (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  tunnel_id TEXT NOT NULL,
  dns_record_id TEXT NOT NULL,
  machine_token_hash TEXT NOT NULL UNIQUE,
  connect_key TEXT NOT NULL,
  local_url TEXT,
  online INTEGER NOT NULL DEFAULT 0,
  last_seen_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX instances_user ON instances (user_id);

CREATE TABLE pair_sessions (
  claim_code TEXT PRIMARY KEY,
  poll_secret_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  public_key TEXT NOT NULL,
  version TEXT NOT NULL,
  client_ip TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  credentials TEXT,
  owner TEXT
);

CREATE INDEX pair_sessions_ip ON pair_sessions (client_ip);
