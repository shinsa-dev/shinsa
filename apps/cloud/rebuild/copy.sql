INSERT INTO users (id, login, name, avatar_url, created_at)
SELECT id, login, name, avatar_url, created_at FROM old_users;

INSERT INTO sessions (token_hash, user_id, expires_at)
SELECT token_hash, user_id, expires_at FROM old_sessions WHERE expires_at > unixepoch() * 1000;

INSERT INTO machines (id, owner_id, name, fingerprint, tunnel_id, dns_record_id, machine_token_hash, connect_key, signing_key, features, local_url, online, last_seen_at, created_at)
SELECT id, user_id, name, fingerprint, tunnel_id, dns_record_id, machine_token_hash, connect_key, signing_key, features, local_url, online, last_seen_at, created_at FROM old_instances;

INSERT INTO machine_invites (machine_id, token_hash, created_at)
SELECT instance_id, token_hash, created_at FROM old_instance_invites;

INSERT INTO machine_handoffs (token_hash, machine_id, created_at)
SELECT token_hash, instance_id, created_at FROM old_instance_handoffs;

INSERT INTO machine_requesters (machine_id, user_id, requested_at)
SELECT instance_id, user_id, requested_at FROM old_instance_requesters;

INSERT INTO machine_members (machine_id, user_id, added_at)
SELECT instance_id, user_id, added_at FROM old_instance_members;

INSERT INTO machine_guests (machine_id, user_id, added_at)
SELECT instance_id, user_id, added_at FROM old_instance_guests;

INSERT INTO teams (id, owner_id, name, scopes, created_at)
SELECT id, user_id, name, scopes, created_at FROM old_teams;

INSERT INTO team_invites (team_id, token_hash, created_at)
SELECT team_id, token_hash, created_at FROM old_team_invites;

INSERT INTO team_requesters (team_id, user_id, requested_at)
SELECT team_id, user_id, requested_at FROM old_team_requesters;

INSERT INTO team_members (team_id, user_id, scopes, added_at)
SELECT team_id, user_id, scopes, added_at FROM old_team_members;

INSERT INTO slack_workspaces (id, name, bot_user_id, sealed_bot_token, installed_at)
SELECT team_id, team_name, bot_user_id, bot_token, installed_at FROM old_slack_workspaces;

INSERT INTO slack_links (workspace_id, slack_user_id, slack_user_name, user_id, machine_id, linked_at)
SELECT team_id, slack_user_id, slack_user_name, user_id, instance_id, linked_at FROM old_slack_links;

INSERT INTO slack_threads (workspace_id, channel_id, thread_ts, machine_id, forwarded_at)
SELECT team_id, channel_id, thread_ts, instance_id, forwarded_at FROM old_slack_threads
WHERE team_id IN (SELECT id FROM slack_workspaces) AND instance_id IN (SELECT id FROM machines);

INSERT INTO slack_posts (workspace_id, channel_id, ts, machine_id)
SELECT team_id, channel_id, ts, instance_id FROM old_slack_posts
WHERE team_id IN (SELECT id FROM slack_workspaces) AND instance_id IN (SELECT id FROM machines);

INSERT INTO slack_events (event_id, received_at)
SELECT event_id, received_at FROM old_slack_events;

DROP TABLE old_slack_events;
DROP TABLE old_slack_posts;
DROP TABLE old_slack_threads;
DROP TABLE old_slack_links;
DROP TABLE old_slack_workspaces;
DROP TABLE old_team_members;
DROP TABLE old_team_requesters;
DROP TABLE old_team_invites;
DROP TABLE old_teams;
DROP TABLE old_instance_guests;
DROP TABLE old_instance_members;
DROP TABLE old_instance_requesters;
DROP TABLE old_instance_handoffs;
DROP TABLE old_instance_invites;
DROP TABLE old_pair_sessions;
DROP TABLE old_instances;
DROP TABLE old_sign_in_codes;
DROP TABLE old_sessions;
DROP TABLE old_users;

DELETE FROM d1_migrations;
INSERT INTO d1_migrations (name) VALUES ('0001_schema.sql');
