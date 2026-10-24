import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ExtensionUsageRead } from '@shinsa/core';
import { writeJsonFile } from '../config/index.ts';
import { describeError, log } from '../log/index.ts';
import { isFields } from './definitions.ts';

type UsageSourceKind = 'claude' | 'shinsa';

interface UsageSource {
  dir: string;
  kind: UsageSourceKind;
}

export interface UsageIndexOptions {
  sources: UsageSource[];
  cachePath: string | null;
  now?: () => number;
  horizonDays?: number;
  chunkBytes?: number;
}

interface FileMark {
  size: number;
  mtimeMs: number;
  offset: number;
}

interface UsageFile {
  version: 1;
  files: Record<string, FileMark>;
  servers: Record<string, number>;
  labels: Record<string, number>;
  skills: Record<string, number>;
  readAt: number | null;
  since: number | null;
}

const DAY_MS = 86_400_000;

const HORIZON_DAYS = 90;

const CHUNK_BYTES = 8 * 1024 * 1024;

const NEWLINE = 0x0a;

const CLAUDE_TOOL =
  /"type":"tool_use","id":"[^"]*","name":"(mcp__[^"]+|Skill)"(?:,"input":\{"skill":"([^"]+)")?/g;

const TIMESTAMP = /"timestamp":"([^"]+)"/;

const SHINSA_MARKERS = ['"kind":"mcp"', '"name":"Skill"'];

const LOADER_TOOLS = new Set(['load_mcp_server', 'call_mcp_tool']);

export function normalizeServerName(name: string) {
  return name.replace(/[^A-Za-z0-9_-]/g, '_');
}

export function resolveServerLabel(name: string) {
  return name.split('_').filter(Boolean).at(-1) ?? name;
}

function createUsageFile(): UsageFile {
  return { version: 1, files: {}, servers: {}, labels: {}, skills: {}, readAt: null, since: null };
}

function readNumbers(value: unknown) {
  if (!isFields(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number')
  );
}

function readMark(value: unknown): FileMark | null {
  if (!isFields(value)) return null;
  const { size, mtimeMs, offset } = value;
  if (typeof size !== 'number' || typeof mtimeMs !== 'number' || typeof offset !== 'number') return null;
  return { size, mtimeMs, offset };
}

function readUsageFile(path: string | null): UsageFile {
  if (!path || !existsSync(path)) return createUsageFile();
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!isFields(parsed)) return createUsageFile();
    const files = isFields(parsed.files)
      ? Object.fromEntries(
          Object.entries(parsed.files).flatMap(([file, mark]) => {
            const read = readMark(mark);
            return read ? [[file, read]] : [];
          })
        )
      : {};
    return {
      version: 1,
      files,
      servers: readNumbers(parsed.servers),
      labels: readNumbers(parsed.labels),
      skills: readNumbers(parsed.skills),
      readAt: typeof parsed.readAt === 'number' ? parsed.readAt : null,
      since: typeof parsed.since === 'number' ? parsed.since : null,
    };
  } catch (error) {
    log.warn('[Extensions] The usage cache could not be read; reading the sessions again', {
      path,
      error: describeError(error),
    });
    return createUsageFile();
  }
}

function listSessionFiles(dir: string) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((entry) => entry.endsWith('.jsonl'))
    .map((entry) => join(dir, entry));
}

function recordLatest(target: Record<string, number>, key: string, at: number) {
  if (!key || !Number.isFinite(at)) return;
  if ((target[key] ?? 0) < at) target[key] = at;
}

function readLineAround(text: string, index: number) {
  const start = text.lastIndexOf('\n', index) + 1;
  const end = text.indexOf('\n', index);
  return text.slice(start, end === -1 ? text.length : end);
}

function readToolArgs(tool: Record<string, unknown>) {
  return isFields(tool.args) ? tool.args : {};
}

export class UsageIndex {
  readonly #options: UsageIndexOptions;
  readonly #now: () => number;
  #file: UsageFile;
  #running: Promise<void> | null = null;
  #stopped = false;

  constructor(options: UsageIndexOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#file = readUsageFile(options.cachePath);
  }

  read(): ExtensionUsageRead {
    return { readAt: this.#file.readAt, since: this.#file.since };
  }

  selectServer(runtimeName: string) {
    const name = normalizeServerName(runtimeName);
    const exact = this.#file.servers[name] ?? null;
    const labelled = this.#file.labels[resolveServerLabel(name)] ?? null;
    if (exact === null) return labelled;
    return labelled === null ? exact : Math.max(exact, labelled);
  }

  selectSkill(name: string) {
    return this.#file.skills[name] ?? null;
  }

  isStale(maxAgeMs: number) {
    return this.#file.readAt === null || this.#now() - this.#file.readAt > maxAgeMs;
  }

  refresh() {
    this.#running ??= this.#scan().finally(() => {
      this.#running = null;
    });
    return this.#running;
  }

  stop() {
    this.#stopped = true;
    return this.#running ?? Promise.resolve();
  }

  async #scan() {
    const now = this.#now();
    const horizon = now - (this.#options.horizonDays ?? HORIZON_DAYS) * DAY_MS;
    const next: UsageFile = { ...this.#file, files: {} };
    for (const source of this.#options.sources) {
      for (const path of listSessionFiles(source.dir)) {
        await this.#scanFile(next, source.kind, path, horizon);
        if (this.#stopped) return;
      }
    }
    next.readAt = now;
    next.since = Math.min(next.since ?? horizon, horizon);
    this.#file = next;
    if (this.#options.cachePath) writeJsonFile(this.#options.cachePath, next);
  }

  async #scanFile(next: UsageFile, kind: UsageSourceKind, path: string, horizon: number) {
    const stat = statSync(path, { throwIfNoEntry: false });
    if (!stat || stat.mtimeMs < horizon) return;
    const known = this.#file.files[path];
    const start = known && known.size <= stat.size ? known.offset : 0;
    if (known && known.size === stat.size && known.mtimeMs === stat.mtimeMs) {
      next.files[path] = known;
      return;
    }
    try {
      const offset = await this.#readFrom(next, kind, path, start, stat.size);
      next.files[path] = { size: stat.size, mtimeMs: stat.mtimeMs, offset };
    } catch (error) {
      log.warn('[Extensions] Could not read a session for usage', { path, error: describeError(error) });
    }
  }

  async #readFrom(next: UsageFile, kind: UsageSourceKind, path: string, start: number, size: number) {
    let chunk = this.#options.chunkBytes ?? CHUNK_BYTES;
    const decoder = new TextDecoder();
    let offset = start;
    while (offset < size) {
      const end = Math.min(size, offset + chunk);
      const bytes = new Uint8Array(await Bun.file(path).slice(offset, end).arrayBuffer());
      const last = bytes.lastIndexOf(NEWLINE);
      if (last === -1) {
        if (end >= size) return offset;
        chunk *= 2;
        continue;
      }
      const text = decoder.decode(bytes.subarray(0, last + 1));
      if (kind === 'claude') this.#readClaude(next, text);
      else this.#readShinsa(next, text, path);
      offset += last + 1;
    }
    return offset;
  }

  #readClaude(next: UsageFile, text: string) {
    for (const match of text.matchAll(CLAUDE_TOOL)) {
      const line = readLineAround(text, match.index);
      const stamp = TIMESTAMP.exec(line)?.[1];
      const at = stamp ? Date.parse(stamp) : Number.NaN;
      const [, name = '', skill] = match;
      if (name === 'Skill') {
        if (skill) recordLatest(next.skills, skill, at);
        continue;
      }
      const server = name.slice('mcp__'.length).split('__')[0] ?? '';
      recordLatest(next.servers, normalizeServerName(server), at);
    }
  }

  #readShinsa(next: UsageFile, text: string, path: string) {
    for (const line of text.split('\n')) {
      if (!SHINSA_MARKERS.some((marker) => line.includes(marker))) continue;
      try {
        this.#readShinsaEntry(next, JSON.parse(line) as unknown);
      } catch (error) {
        log.warn('[Extensions] Skipped a transcript line it could not read for usage', {
          path,
          error: describeError(error),
        });
      }
    }
  }

  #readShinsaEntry(next: UsageFile, entry: unknown) {
    if (!isFields(entry) || entry.type !== 'tool_call' || !isFields(entry.tool)) return;
    const at = typeof entry.at === 'number' ? entry.at : Number.NaN;
    const { tool } = entry;
    const args = readToolArgs(tool);
    if (tool.kind === 'other' && tool.name === 'Skill' && typeof args.skill === 'string') {
      recordLatest(next.skills, args.skill, at);
      return;
    }
    if (tool.kind !== 'mcp' || typeof tool.server !== 'string') return;
    if (tool.server === 'shinsa' && typeof tool.name === 'string' && LOADER_TOOLS.has(tool.name)) {
      const loaded = typeof args.name === 'string' ? args.name : args.server;
      if (typeof loaded === 'string') recordLatest(next.servers, normalizeServerName(loaded), at);
      return;
    }
    recordLatest(next.labels, tool.server, at);
  }
}
