ALTER TABLE users ADD COLUMN name TEXT;

CREATE TABLE instance_invites (
  token_hash TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL REFERENCES instances (id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  claimed_by TEXT REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX instance_invites_instance ON instance_invites (instance_id);

CREATE TABLE instance_members (
  instance_id TEXT NOT NULL REFERENCES instances (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (instance_id, user_id)
);

CREATE INDEX instance_members_user ON instance_members (user_id);
