import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveSharedConfigDir } from '../accounts/paths.ts';

interface SessionLine {
  type?: string;
  cwd?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  message?: { role?: string; content?: unknown };
}

export interface ImportedSession {
  path: string;
  cwd: string | null;
  firstRequest: string;
  laterRequests: string[];
  lastReply: string | null;
}

const MAX_SECTION = 4_000;

const LATER_REQUESTS = 6;

const INTERNAL_TEXT = /^<(command-|local-command|system-reminder|kanna-|task-notification)/;

const SESSION_ID = /^[\w-]+$/;

function selectSessionPath(target: string, projectsDir: string) {
  if (existsSync(target) && statSync(target).isFile()) return target;
  if (!SESSION_ID.test(target) || !existsSync(projectsDir)) return null;
  for (const project of readdirSync(projectsDir)) {
    const candidate = join(projectsDir, project, `${target}.jsonl`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function readText(content: unknown) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (part): part is { type: string; text: string } => part?.type === 'text' && typeof part.text === 'string'
    )
    .map((part) => part.text)
    .join('\n');
}

function parseLine(raw: string): SessionLine | null {
  try {
    return JSON.parse(raw) as SessionLine;
  } catch {
    return null;
  }
}

function clip(text: string) {
  const trimmed = text.trim();
  return trimmed.length > MAX_SECTION ? `${trimmed.slice(0, MAX_SECTION)}…` : trimmed;
}

function resolveProjectsDir() {
  return join(resolveSharedConfigDir(Bun.env, homedir()), 'projects');
}

export function readSession(target: string, projectsDir = resolveProjectsDir()): ImportedSession {
  const path = selectSessionPath(target, projectsDir);
  if (!path) throw new Error(`No Claude Code session at ${target}. Pass a .jsonl path or a session id.`);
  let cwd: string | null = null;
  const requests: string[] = [];
  let lastReply: string | null = null;
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim() ? parseLine(raw) : null;
    if (!line || line.isSidechain || line.isMeta) continue;
    cwd ??= line.cwd ?? null;
    const text = readText(line.message?.content).trim();
    if (!text || INTERNAL_TEXT.test(text)) continue;
    if (line.type === 'user' && line.message?.role === 'user') requests.push(text);
    if (line.type === 'assistant') lastReply = text;
  }
  const [firstRequest, ...laterRequests] = requests;
  if (!firstRequest) throw new Error(`${path} has no user messages to import.`);
  return { path, cwd, firstRequest, laterRequests, lastReply };
}

export function describeSession(session: ImportedSession) {
  const later = session.laterRequests.slice(-LATER_REQUESTS);
  return [
    'Continue the work from an earlier Claude Code session. Read the full transcript before planning.',
    '',
    'What was asked first:',
    clip(session.firstRequest),
    ...(later.length > 0
      ? ['', 'Later requests, oldest first:', ...later.map((request) => `- ${clip(request)}`)]
      : []),
    ...(session.lastReply ? ['', 'Where the session ended:', clip(session.lastReply)] : []),
    '',
    `Full transcript: ${session.path}`,
  ].join('\n');
}
