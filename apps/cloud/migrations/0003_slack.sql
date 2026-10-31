CREATE TABLE slack_workspaces (
  team_id TEXT PRIMARY KEY,
  team_name TEXT NOT NULL,
  bot_user_id TEXT NOT NULL,
  bot_token TEXT NOT NULL,
  installed_at INTEGER NOT NULL
);

CREATE TABLE slack_links (
  team_id TEXT NOT NULL REFERENCES slack_workspaces (team_id) ON DELETE CASCADE,
  slack_user_id TEXT NOT NULL,
  slack_user_name TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  instance_id TEXT NOT NULL REFERENCES instances (id) ON DELETE CASCADE,
  linked_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, slack_user_id)
);

CREATE INDEX slack_links_instance ON slack_links (instance_id);

CREATE TABLE slack_threads (
  team_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  thread_ts TEXT NOT NULL,
  instance_id TEXT NOT NULL REFERENCES instances (id) ON DELETE CASCADE,
  forwarded_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, channel_id, thread_ts, instance_id)
);

CREATE TABLE slack_posts (
  team_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  instance_id TEXT NOT NULL REFERENCES instances (id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, channel_id, ts)
);

CREATE TABLE slack_events (
  event_id TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL
);

CREATE INDEX slack_events_received ON slack_events (received_at);
