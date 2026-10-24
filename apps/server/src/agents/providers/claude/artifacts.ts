import { closeSync, existsSync, openSync, readdirSync, readSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolveSharedConfigDir } from '../../../accounts/paths.ts';
import type { SessionArtifactStatus, SessionQuery } from '../types.ts';

export interface ClaudeSessionQuery extends SessionQuery {
  env?: Record<string, string | undefined>;
  home?: string;
}

const SAFE_SESSION_ID = /^[A-Za-z0-9][\w.-]*$/;

const CHUNK_BYTES = 64 * 1024;

export function resolveClaudeConfigDir(cwd: string, env: Record<string, string | undefined>, home: string) {
  return resolve(cwd, resolveSharedConfigDir(env, home));
}

export function resolveClaudeProjectName(cwd: string) {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

function isConversationLine(line: string) {
  try {
    const type = (JSON.parse(line) as { type?: unknown }).type;
    return type === 'user' || type === 'assistant';
  } catch {
    return false;
  }
}

export function hasConversation(path: string) {
  const handle = openSync(path, 'r');
  const buffer = Buffer.alloc(CHUNK_BYTES);
  let carry = '';
  try {
    for (;;) {
      const read = readSync(handle, buffer, 0, CHUNK_BYTES, null);
      if (read === 0) return carry.trim().length > 0 && isConversationLine(carry);
      const lines = (carry + buffer.toString('utf8', 0, read)).split('\n');
      carry = lines.pop() ?? '';
      if (lines.some(isConversationLine)) return true;
    }
  } finally {
    closeSync(handle);
  }
}

function listProjects(projectsDir: string) {
  try {
    return readdirSync(projectsDir);
  } catch {
    return null;
  }
}

export function resolveClaudeSessionStatus(query: ClaudeSessionQuery): SessionArtifactStatus {
  if (!SAFE_SESSION_ID.test(query.sessionId)) return 'unknown';
  const configDir = resolveClaudeConfigDir(query.cwd, query.env ?? Bun.env, query.home ?? homedir());
  const projectsDir = join(configDir, 'projects');
  const projects = listProjects(projectsDir);
  if (!projects) return 'unknown';
  let found = false;
  for (const project of projects) {
    const path = join(projectsDir, project, `${query.sessionId}.jsonl`);
    if (!existsSync(path)) continue;
    try {
      if (hasConversation(path)) return 'present';
    } catch {
      return 'unknown';
    }
    found = true;
  }
  if (found) return 'empty';
  return existsSync(join(projectsDir, resolveClaudeProjectName(query.cwd))) ? 'missing' : 'unknown';
}
