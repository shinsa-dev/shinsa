CREATE TABLE sign_in_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX sign_in_codes_expiry ON sign_in_codes (expires_at);
