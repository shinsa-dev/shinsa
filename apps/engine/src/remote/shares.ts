import { statSync } from 'node:fs';
import { extname } from 'node:path';
import {
  DomainError,
  isShareId,
  parseShareUrl,
  parseUnifiedDiff,
  type Repo,
  resolveSharedTask,
  resolveSharePreset,
  SHARE_CODE_FILE,
  SHARE_DIFF_FILE,
  SHARE_FILE_BYTES,
  SHARE_ID_BYTES,
  SHARE_KEY_BYTES,
  SHARED_EVIDENCE_PREFIX,
  type SharedTask,
  type ShareFileType,
  type ShareLiveView,
  serializeBase64Url,
  serializeShareUrl,
  type Task,
} from '@shinsa/core';
import { readPullRequestDiff, readRepoFile, resolveRepoSlug } from '../github/index.ts';
import { describeError, log } from '../log/index.ts';
import type { EffectContext, Engine } from '../runtime/engine.ts';
import { EffectError } from '../runtime/failures.ts';
import { EVIDENCE_ROUTE, type EvidenceStore } from '../store/evidence.ts';
import type { ChannelPeer } from './channel.ts';
import type { Remote } from './index.ts';
import { type LiveFile, type LiveShare, SHARE_GONE_REASON, ShareChannel } from './share-channel.ts';

export const SHARE_NOT_PAIRED =
  'Turn on remote access in Settings → General to share this task. Its link works once this machine is paired.';

export const SHARE_LINK_LOST =
  'This machine was paired with remote access again, so the old link no longer reaches it. Share this task again for a new link.';

export const SHARE_REMOTE_CHANGED = 'Remote access on the machine that shares this task was turned off.';

const FINAL = { retryable: false, delayMs: null };

const FILE_TYPES: Readonly<Record<string, ShareFileType>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.md': 'text/plain',
  '.txt': 'text/plain',
};

export interface ShareGitHub {
  readDiff: (repo: Repo, number: number) => Promise<string>;
  readFile: (repo: Repo, ref: string, path: string) => Promise<string>;
}

export interface SharedCode {
  files: Record<string, string>;
}

export interface ShareEffects {
  link: (taskId: string, context: EffectContext) => Promise<void>;
}

export interface ShareLinks {
  acceptsShare: (shareId: string) => boolean;
  openChannel: (peer: ChannelPeer, shareId: string) => ShareChannel;
  closeChannel: (channel: ShareChannel) => void;
}

export interface SharesOptions {
  engine: Engine;
  remote: Remote;
  evidence: EvidenceStore;
  github?: ShareGitHub;
  now?: () => number;
  random?: (bytes: number) => Uint8Array<ArrayBuffer>;
}

interface HashedFile {
  size: number;
  modifiedAt: number;
  hash: string;
}

const GITHUB: ShareGitHub = { readDiff: readPullRequestDiff, readFile: readRepoFile };

const CODE_FILE_LIMIT = 300;

const CODE_STATUSES: ReadonlySet<string> = new Set(['modified', 'renamed']);

function resolveRepositoryName(repo: Repo | null) {
  if (!repo) return null;
  const slug = resolveRepoSlug(repo);
  return slug ? `${slug.owner}/${slug.name}` : repo.name;
}

function resolveBytesHash(bytes: Uint8Array) {
  return new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
}

function createRandom(bytes: number) {
  return crypto.getRandomValues(new Uint8Array(bytes));
}

function isListed(item: SharedTask['evidence'][number], files: Record<string, string>) {
  return !item.uri.startsWith(SHARED_EVIDENCE_PREFIX) || item.id in files;
}

function createTextFile(id: string, version: string, bytes: Uint8Array<ArrayBuffer>): LiveFile | null {
  if (bytes.byteLength > SHARE_FILE_BYTES) return null;
  return { id, version, type: 'text/plain', read: async () => bytes };
}

export class Shares implements ShareEffects, ShareLinks {
  readonly #engine: Engine;
  readonly #remote: Remote;
  readonly #evidence: EvidenceStore;
  readonly #github: ShareGitHub;
  readonly #now: () => number;
  readonly #random: (bytes: number) => Uint8Array<ArrayBuffer>;
  readonly #hashes = new Map<string, HashedFile>();
  readonly #code = new Map<string, { key: string; files: LiveFile[] }>();
  readonly #channels = new Set<ShareChannel>();
  #pairedAs: string | null;

  constructor(options: SharesOptions) {
    this.#engine = options.engine;
    this.#remote = options.remote;
    this.#evidence = options.evidence;
    this.#github = options.github ?? GITHUB;
    this.#now = options.now ?? Date.now;
    this.#random = options.random ?? createRandom;
    this.#pairedAs = this.#selectInstanceId();
    options.remote.subscribe(() => this.#syncRemote());
    options.engine.subscribe(() => this.#syncChannels());
  }

  #selectInstanceId() {
    return this.#remote.store.file.credentials?.instanceId ?? null;
  }

  #syncRemote() {
    if (!this.#remote.isEnabled) this.#endChannels(() => true, SHARE_REMOTE_CHANGED);
    const before = this.#pairedAs;
    this.#pairedAs = this.#selectInstanceId();
    if (before === null || before === this.#pairedAs) return;
    for (const task of Object.values(this.#engine.state.tasks)) {
      if (!task.share?.url || task.share.failure) continue;
      this.#engine
        .dispatch({ type: 'share.fail', taskId: task.id, detail: SHARE_LINK_LOST })
        .catch((error: unknown) => {
          log.error('[Share] Could not mark a link as lost', {
            taskId: task.id,
            error: describeError(error),
          });
        });
    }
  }

  #syncChannels() {
    this.#endChannels(
      (channel) => channel.taskId !== null && this.#resolveShare(channel.shareId)?.taskId !== channel.taskId,
      SHARE_GONE_REASON
    );
    for (const channel of this.#channels) if (channel.taskId) void channel.push();
  }

  #endChannels(match: (channel: ShareChannel) => boolean, reason: string) {
    for (const channel of [...this.#channels]) {
      if (!match(channel)) continue;
      this.#channels.delete(channel);
      void channel.end(reason);
    }
  }

  #resolveShare(shareId: string) {
    const instanceId = this.#selectInstanceId();
    if (!instanceId) return null;
    for (const task of Object.values(this.#engine.state.tasks)) {
      if ((task.share?.endsAt ?? Number.POSITIVE_INFINITY) <= this.#now()) continue;
      const link = parseShareUrl(task.share?.url ?? null);
      if (link?.shareId === shareId && link.instanceId === instanceId)
        return { taskId: task.id, key: link.key };
    }
    return null;
  }

  acceptsShare(shareId: string) {
    return this.#remote.isEnabled && isShareId(shareId);
  }

  openChannel(peer: ChannelPeer, shareId: string) {
    const channel = new ShareChannel(peer, shareId, {
      resolveShare: (id) => this.#resolveShare(id),
      resolveLive: (taskId) => this.resolveLive(taskId),
    });
    this.#channels.add(channel);
    return channel;
  }

  closeChannel(channel: ShareChannel) {
    channel.close();
    this.#channels.delete(channel);
  }

  async link(taskId: string, context: EffectContext) {
    const task = this.#engine.state.tasks[taskId];
    if (!task?.share) return;
    const credentials = this.#remote.store.file.credentials;
    if (!credentials) throw new EffectError(SHARE_NOT_PAIRED, SHARE_NOT_PAIRED, FINAL);
    const current = parseShareUrl(task.share.url);
    const url =
      current?.instanceId === credentials.instanceId
        ? null
        : serializeShareUrl(this.#remote.appOrigin, {
            instanceId: credentials.instanceId,
            shareId: serializeBase64Url(this.#random(SHARE_ID_BYTES)),
            key: serializeBase64Url(this.#random(SHARE_KEY_BYTES)),
          });
    await this.#engine.dispatch({ type: 'share.record', taskId, url }, { id: `${context.key}:share.record` });
  }

  async resolveLive(taskId: string): Promise<LiveShare> {
    const task = this.#findTask(taskId);
    const { shared, repo } = this.#resolveShared(task);
    const files = [
      ...(await this.#listEvidenceFiles(shared)),
      ...(await this.#listLiveCodeFiles(shared, task, repo)),
    ];
    const listed = Object.fromEntries(files.map((file) => [file.id, file.id]));
    const view: ShareLiveView = {
      shared: { ...shared, evidence: shared.evidence.filter((item) => isListed(item, listed)) },
      files: Object.fromEntries(files.map((file) => [file.id, { version: file.version, type: file.type }])),
      updatedAt: this.#now(),
    };
    return { view, files };
  }

  #findTask(taskId: string) {
    const task = this.#engine.state.tasks[taskId];
    if (!task) throw new DomainError('task_not_found', 'No such task.');
    return task;
  }

  #resolveShared(task: Task) {
    const repo = task.repoId ? (this.#engine.state.repos[task.repoId] ?? null) : null;
    const shared = resolveSharedTask(this.#engine.state, task, {
      preset: task.share?.preset ?? resolveSharePreset(this.#engine.state.settings),
      owner: this.#remote.store.file.owner,
      machine: this.#remote.snapshot().machineName,
      repository: resolveRepositoryName(repo),
    });
    return { shared, repo };
  }

  async #listEvidenceFiles(shared: SharedTask) {
    const files: LiveFile[] = [];
    for (const item of shared.evidence) {
      if (!item.uri.startsWith(SHARED_EVIDENCE_PREFIX)) continue;
      const file = await this.#resolveEvidenceFile(item.id);
      if (file) files.push(file);
    }
    return files;
  }

  #selectEvidencePath(evidenceId: string) {
    const original = this.#engine.state.evidence[evidenceId];
    if (!original?.uri.startsWith(EVIDENCE_ROUTE)) return null;
    const path = this.#evidence.selectFile(original.uri.slice(EVIDENCE_ROUTE.length));
    const type = path ? FILE_TYPES[extname(path).toLowerCase()] : undefined;
    if (!path || !type) return null;
    const stat = statSync(path);
    if (stat.size > SHARE_FILE_BYTES) return null;
    return { path, type, stat };
  }

  async #resolveEvidenceFile(evidenceId: string): Promise<LiveFile | null> {
    const selected = this.#selectEvidencePath(evidenceId);
    if (!selected) return null;
    const { path, type, stat } = selected;
    const read = async () => new Uint8Array(await Bun.file(path).arrayBuffer());
    return { id: evidenceId, version: await this.#resolveFileHash(path, stat, read), type, read };
  }

  async #resolveFileHash(path: string, stat: { size: number; mtimeMs: number }, read: LiveFile['read']) {
    const known = this.#hashes.get(path);
    if (known && known.size === stat.size && known.modifiedAt === stat.mtimeMs) return known.hash;
    const hash = resolveBytesHash(await read());
    this.#hashes.set(path, { size: stat.size, modifiedAt: stat.mtimeMs, hash });
    return hash;
  }

  async #listLiveCodeFiles(shared: SharedTask, task: Task, repo: Repo | null) {
    try {
      return await this.#listCodeFiles(shared, task, repo);
    } catch (error) {
      log.warn('[Share] Could not read the pull request from GitHub', {
        taskId: task.id,
        error: describeError(error),
      });
      return [];
    }
  }

  async #listCodeFiles(shared: SharedTask, task: Task, repo: Repo | null) {
    const pullRequest = task.pullRequest;
    if (!(shared.code && repo && pullRequest)) return [];
    const key = `${pullRequest.number}:${pullRequest.headSha ?? ''}`;
    const cached = this.#code.get(task.id);
    if (cached?.key === key) return cached.files;
    const diff = await this.#github.readDiff(repo, pullRequest.number);
    const encoder = new TextEncoder();
    const diffFile = createTextFile(SHARE_DIFF_FILE, key, encoder.encode(diff));
    let codeFile: LiveFile | null = null;
    if (diffFile && pullRequest.headSha) {
      const code = await this.#readChangedFiles(repo, pullRequest.headSha, diff);
      codeFile = createTextFile(SHARE_CODE_FILE, key, encoder.encode(JSON.stringify(code)));
    }
    const files = [diffFile, codeFile].flatMap((file) => file ?? []);
    this.#code.set(task.id, { key, files });
    return files;
  }

  async #readChangedFiles(repo: Repo, head: string, diff: string): Promise<SharedCode> {
    const files: Record<string, string> = {};
    let bytes = 0;
    const changed = parseUnifiedDiff(diff).filter((file) => CODE_STATUSES.has(file.status) && !file.binary);
    for (const file of changed.slice(0, CODE_FILE_LIMIT)) {
      try {
        const content = await this.#github.readFile(repo, head, file.path);
        bytes += content.length;
        if (bytes > SHARE_FILE_BYTES) break;
        files[file.path] = content;
      } catch (error) {
        log.warn('[Share] Could not read a changed file from GitHub', {
          path: file.path,
          error: describeError(error),
        });
      }
    }
    return { files };
  }
}
