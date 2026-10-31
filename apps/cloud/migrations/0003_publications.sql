CREATE TABLE publications (
  task_id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL REFERENCES instances (id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  link_token_hash TEXT UNIQUE,
  updated_at INTEGER NOT NULL
);

CREATE INDEX publications_instance ON publications (instance_id);

CREATE TABLE files (
  instance_id TEXT NOT NULL REFERENCES instances (id) ON DELETE CASCADE,
  hash TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (instance_id, hash)
);

CREATE TABLE publication_files (
  task_id TEXT NOT NULL REFERENCES publications (task_id) ON DELETE CASCADE,
  file_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  hash TEXT NOT NULL,
  PRIMARY KEY (task_id, file_id)
);

CREATE INDEX publication_files_hash ON publication_files (instance_id, hash);
