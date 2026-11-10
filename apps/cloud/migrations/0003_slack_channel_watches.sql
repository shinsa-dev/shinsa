CREATE TABLE slack_channel_watches (
  workspace_id TEXT NOT NULL REFERENCES slack_workspaces (id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  machine_id TEXT NOT NULL REFERENCES machines (id) ON DELETE CASCADE,
  PRIMARY KEY (workspace_id, channel_id, machine_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX slack_channel_watches_machine ON slack_channel_watches (machine_id);
