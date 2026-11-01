CREATE TABLE instance_handoffs (
  token_hash TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL REFERENCES instances (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE INDEX instance_handoffs_instance ON instance_handoffs (instance_id);

CREATE TABLE instance_guests (
  instance_id TEXT NOT NULL REFERENCES instances (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (instance_id, user_id)
);

CREATE INDEX instance_guests_user ON instance_guests (user_id);
