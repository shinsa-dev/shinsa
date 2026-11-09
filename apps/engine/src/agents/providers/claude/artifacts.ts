import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { Effect, FileSystem, Option, Schema, Stream } from 'effect';
import { resolveSharedConfigDir } from '../../../accounts/paths.ts';
import { isPresent } from '../../../files/probe.ts';
import type { SessionArtifactStatus, SessionQuery } from '../types.ts';
import { CHUNK_BYTES, ConversationLine, SAFE_SESSION_ID } from './schema.ts';

export interface ClaudeSessionQuery extends SessionQuery {
  env?: Record<string, string | undefined>;
  home?: string;
}

export function resolveClaudeConfigDir(cwd: string, env: Record<string, string | undefined>, home: string) {
  return resolve(cwd, resolveSharedConfigDir(env, home));
}

export function resolveClaudeProjectName(cwd: string) {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

const decodeConversationLine = Schema.decodeUnknownOption(Schema.fromJsonString(ConversationLine));

const isConversationLine = (line: string) => Option.isSome(decodeConversationLine(line));

export const hasConversation = Effect.fn('ClaudeArtifacts.hasConversation')(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  const found = yield* fs
    .stream(path, { chunkSize: CHUNK_BYTES })
    .pipe(Stream.decodeText, Stream.splitLines, Stream.filter(isConversationLine), Stream.runHead);
  return Option.isSome(found);
});

export const resolveClaudeSessionStatus = Effect.fn('ClaudeArtifacts.resolveClaudeSessionStatus')(function* (
  query: ClaudeSessionQuery
) {
  if (!SAFE_SESSION_ID.test(query.sessionId)) return 'unknown' satisfies SessionArtifactStatus;
  const fs = yield* FileSystem.FileSystem;
  const configDir = resolveClaudeConfigDir(query.cwd, query.env ?? Bun.env, query.home ?? homedir());
  const projectsDir = join(configDir, 'projects');
  const projects = yield* Effect.option(fs.readDirectory(projectsDir));
  if (Option.isNone(projects)) return 'unknown' satisfies SessionArtifactStatus;
  let found = false;
  for (const project of projects.value) {
    const path = join(projectsDir, project, `${query.sessionId}.jsonl`);
    if (!(yield* isPresent(path))) continue;
    const conversation = yield* Effect.option(hasConversation(path));
    if (Option.isNone(conversation)) return 'unknown' satisfies SessionArtifactStatus;
    if (conversation.value) return 'present' satisfies SessionArtifactStatus;
    found = true;
  }
  if (found) return 'empty' satisfies SessionArtifactStatus;
  const known = yield* isPresent(join(projectsDir, resolveClaudeProjectName(query.cwd)));
  return (known ? 'missing' : 'unknown') satisfies SessionArtifactStatus;
});
