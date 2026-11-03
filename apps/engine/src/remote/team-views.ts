import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseShareMessage, type ShareLiveView, type ShareMessage } from '@shinsa/core';
import { readJsonFile, writeJsonFile } from '../files/index.ts';
import { describeError, log } from '../log/index.ts';
import { TeamViewFile, TeamViewsIndexFile, VIEW_FILE_MISSING } from './schema.ts';

export const TEAM_VIEWS_DIR = 'team-views';

const TEAM_VIEW_FILES_LIMIT = 8 * 1024 * 1024;

export const TEAM_VIEWS_LIMIT = 64 * 1024 * 1024;

const INDEX_FILE = 'index.json';

export interface TeamViewEntry {
  teamId: string;
  instanceId: string;
  taskId: string;
  keyDigest: string;
  updatedAt: number;
  size: number;
}

export interface HeldTeamView extends Omit<TeamViewEntry, 'size'> {
  messages: ShareMessage[];
}

interface StoredFile {
  version: string;
  messages: ShareMessage[];
  size: number;
}

interface ReceivingFile extends StoredFile {
  dropped: boolean;
}

function readLiveView(data: string): ShareLiveView | null {
  try {
    const view = JSON.parse(data) as Partial<ShareLiveView> | null;
    const updatedAt = view?.shared?.task?.updatedAt;
    return typeof updatedAt === 'number' && view?.files && typeof view.files === 'object'
      ? (view as ShareLiveView)
      : null;
  } catch {
    return null;
  }
}

export class TeamViewRecorder {
  readonly #limit: number;
  #view: ShareMessage | null = null;
  #listed: ShareLiveView['files'] = {};
  #updatedAt: number | null = null;
  readonly #stored = new Map<string, StoredFile>();
  readonly #settled = new Set<string>();
  readonly #receiving = new Map<string, ReceivingFile>();

  constructor(limit = TEAM_VIEW_FILES_LIMIT) {
    this.#limit = limit;
  }

  get updatedAt() {
    return this.#updatedAt;
  }

  get isComplete() {
    return this.#view !== null && Object.keys(this.#listed).every((id) => this.#settled.has(id));
  }

  receive(message: ShareMessage) {
    switch (message.t) {
      case 'view':
        return this.#receiveView(message);
      case 'file':
        this.#receiving.set(message.id, {
          version: message.version,
          messages: [message],
          size: 0,
          dropped: false,
        });
        return false;
      case 'body': {
        const file = this.#receiving.get(message.id);
        if (!file || file.dropped) return false;
        file.size += message.chunk.length;
        if (this.#storedSize() + file.size > this.#limit) file.dropped = true;
        else file.messages.push(message);
        return false;
      }
      case 'end':
        return this.#receiveEnd(message.id, message);
      default:
        return false;
    }
  }

  #receiveView(message: Extract<ShareMessage, { t: 'view' }>) {
    const view = readLiveView(message.data);
    if (!view) return false;
    this.#view = message;
    this.#listed = view.files;
    this.#updatedAt = view.shared.task.updatedAt;
    for (const [id, file] of this.#stored) {
      if (this.#listed[id]?.version === file.version) continue;
      this.#stored.delete(id);
      this.#settled.delete(id);
    }
    return true;
  }

  #receiveEnd(id: string, message: ShareMessage) {
    const file = this.#receiving.get(id);
    this.#receiving.delete(id);
    if (!file) return false;
    this.#settled.add(id);
    if (file.dropped) return false;
    this.#stored.set(id, { version: file.version, messages: [...file.messages, message], size: file.size });
    return true;
  }

  #storedSize() {
    let size = 0;
    for (const file of this.#stored.values()) size += file.size;
    return size;
  }

  messages(): ShareMessage[] {
    if (!this.#view) return [];
    return [this.#view, ...[...this.#stored.values()].flatMap((file) => file.messages)];
  }
}

function resolveViewKey(teamId: string, instanceId: string, taskId: string) {
  return `${teamId} ${instanceId} ${taskId}`;
}

function resolveViewFile(key: string) {
  return `${createHash('sha256').update(key).digest('hex')}.json`;
}

export class TeamViews {
  readonly dir: string;
  readonly #limit: number;
  readonly #entries = new Map<string, TeamViewEntry>();

  constructor(dir: string, limit = TEAM_VIEWS_LIMIT) {
    this.dir = dir;
    this.#limit = limit;
    for (const entry of this.#readIndex())
      this.#entries.set(resolveViewKey(entry.teamId, entry.instanceId, entry.taskId), entry);
  }

  #readIndex() {
    const path = join(this.dir, INDEX_FILE);
    const { value, problem } = readJsonFile(path, TeamViewsIndexFile);
    if (problem !== null) {
      log.warn('[Teams] Could not read the kept team task views', { path, error: problem });
      return [];
    }
    return value?.entries ?? [];
  }

  list() {
    return [...this.#entries.values()];
  }

  selectEntry(teamId: string, instanceId: string, taskId: string) {
    return this.#entries.get(resolveViewKey(teamId, instanceId, taskId)) ?? null;
  }

  select(teamId: string, instanceId: string, taskId: string): HeldTeamView | null {
    const key = resolveViewKey(teamId, instanceId, taskId);
    const entry = this.#entries.get(key);
    if (!entry || entry.size === 0) return null;
    const { value, problem } = readJsonFile(join(this.dir, resolveViewFile(key)), TeamViewFile);
    if (!value) {
      log.warn('[Teams] Could not read a kept team task view', {
        taskId,
        error: problem ?? VIEW_FILE_MISSING,
      });
      return null;
    }
    const { messages: listed = [] } = value;
    const messages = listed.flatMap((message) => parseShareMessage(JSON.stringify(message)) ?? []);
    return messages.length > 0 ? { ...entry, messages } : null;
  }

  write(view: HeldTeamView) {
    const key = resolveViewKey(view.teamId, view.instanceId, view.taskId);
    const { messages, ...entry } = view;
    const size = Buffer.byteLength(JSON.stringify(messages));
    try {
      writeJsonFile(join(this.dir, resolveViewFile(key)), { version: 1, messages });
      this.#entries.set(key, { ...entry, size });
      this.#evictOver(key);
      this.#saveIndex();
    } catch (error) {
      log.warn('[Teams] Could not keep a team task view', { dir: this.dir, error: describeError(error) });
    }
  }

  #evictOver(kept: string) {
    let total = 0;
    for (const entry of this.#entries.values()) total += entry.size;
    const oldest = [...this.#entries].sort(([, a], [, b]) => a.updatedAt - b.updatedAt);
    for (const [key, entry] of oldest) {
      if (total <= this.#limit) return;
      if (key === kept || entry.size === 0) continue;
      rmSync(join(this.dir, resolveViewFile(key)), { force: true });
      total -= entry.size;
      this.#entries.set(key, { ...entry, size: 0 });
    }
  }

  removeWhere(matches: (entry: TeamViewEntry) => boolean) {
    let removed = false;
    for (const [key, entry] of this.#entries) {
      if (!matches(entry)) continue;
      this.#entries.delete(key);
      rmSync(join(this.dir, resolveViewFile(key)), { force: true });
      removed = true;
    }
    if (removed) this.#saveIndex();
  }

  #saveIndex() {
    try {
      if (this.#entries.size === 0) {
        rmSync(this.dir, { recursive: true, force: true });
        return;
      }
      writeJsonFile(join(this.dir, INDEX_FILE), { version: 1, entries: this.list() });
    } catch (error) {
      log.warn('[Teams] Could not keep the team task views', { dir: this.dir, error: describeError(error) });
    }
  }
}
