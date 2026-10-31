ALTER TABLE users ADD COLUMN name TEXT;

CREATE TABLE instance_invites (
  instance_id TEXT PRIMARY KEY REFERENCES instances (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE instance_requesters (
  instance_id TEXT NOT NULL REFERENCES instances (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  requested_at INTEGER NOT NULL,
  PRIMARY KEY (instance_id, user_id)
);

CREATE TABLE instance_members (
  instance_id TEXT NOT NULL REFERENCES instances (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (instance_id, user_id)
);

CREATE INDEX instance_members_user ON instance_members (user_id);
