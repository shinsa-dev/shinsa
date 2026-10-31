import { statSync } from 'node:fs';
import { extname } from 'node:path';
import {
  DomainError,
  type MachineCredentials,
  PUBLICATION_LIMITS,
  type Repo,
  resolveSharedTask,
  resolveSharePreviewDiffApiPath,
  SHARE_DIFF_FILE,
  SHARED_EVIDENCE_PREFIX,
  type SharedTask,
  type ShareFileType,
  type SharePreview,
  type Task,
} from '@shinsa/core';
import { readPullRequestDiff, resolveRepoSlug } from '../github/index.ts';
import type { ApiRoute } from '../http/routes.ts';
import { describeError, log } from '../log/index.ts';
import type { EffectContext, Engine } from '../runtime/engine.ts';
import { EffectError } from '../runtime/failures.ts';
import { EVIDENCE_ROUTE, type EvidenceStore } from '../store/evidence.ts';
import { ControlError, RevokedError } from './control.ts';
import type { Remote } from './index.ts';

export const SHARE_NOT_PAIRED =
  'Turn on remote access in Settings → General to share this task. Its link works once this machine is paired.';

export const SHARE_LINK_LOST =
  'Remote access was removed from this machine, so app.shinsa.dev no longer serves this link. Turn remote access on again, then share this task again for a new link.';

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
}

export interface SharePreviewer {
  preview: (taskId: string) => SharePreview;
  previewDiff: (taskId: string) => Promise<string>;
}

export interface ShareEffects {
  publish: (taskId: string, context: EffectContext) => Promise<void>;
  remove: (taskId: string) => Promise<void>;
}

export interface SharePublisherOptions {
  engine: Engine;
  remote: Remote;
  evidence: EvidenceStore;
  github?: ShareGitHub;
  now?: () => number;
}

interface PublishedFile {
  id: string;
  hash: string;
  contentType: ShareFileType;
  read: () => Promise<Uint8Array<ArrayBuffer>>;
}

interface HashedFile {
  size: number;
  modifiedAt: number;
  hash: string;
}

const GITHUB: ShareGitHub = { readDiff: readPullRequestDiff };

function resolveRepositoryName(repo: Repo | null) {
  if (!repo) return null;
  const slug = resolveRepoSlug(repo);
  return slug ? `${slug.owner}/${slug.name}` : repo.name;
}

function resolveBytesHash(bytes: Uint8Array) {
  return new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
}

function resolveControlFailure(error: unknown) {
  if (error instanceof RevokedError) return new EffectError(SHARE_NOT_PAIRED, SHARE_NOT_PAIRED, FINAL);
  if (error instanceof ControlError && error.status < 500)
    return new EffectError(error.message, error.message, FINAL);
  return error;
}

function isListed(item: SharedTask['evidence'][number], files: Record<string, string>) {
  return !item.uri.startsWith(SHARED_EVIDENCE_PREFIX) || item.id in files;
}

export function createSharePreviewRoutes(shares: SharePreviewer): ApiRoute[] {
  return [
    {
      method: 'GET',
      pattern: /^\/api\/tasks\/([^/]+)\/share\/preview$/,
      respond: ([, taskId = '']) =>
        Promise.resolve(taskId).then((id) => Response.json(shares.preview(decodeURIComponent(id)))),
    },
    {
      method: 'GET',
      pattern: /^\/api\/tasks\/([^/]+)\/share\/preview\/diff$/,
      respond: async ([, taskId = '']) =>
        new Response(await shares.previewDiff(decodeURIComponent(taskId)), {
          headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
        }),
    },
  ];
}

function isPublished(files: readonly PublishedFile[]) {
  const ids = new Set(files.map((file) => file.id));
  return (item: SharedTask['evidence'][number]) =>
    !item.uri.startsWith(SHARED_EVIDENCE_PREFIX) || ids.has(item.uri.slice(SHARED_EVIDENCE_PREFIX.length));
}

function createDiffFile(bytes: Uint8Array<ArrayBuffer>): PublishedFile | null {
  if (bytes.byteLength > PUBLICATION_LIMITS.fileBytes) return null;
  return {
    id: SHARE_DIFF_FILE,
    hash: resolveBytesHash(bytes),
    contentType: 'text/plain',
    read: async () => bytes,
  };
}

export class SharePublisher implements ShareEffects, SharePreviewer {
  readonly #engine: Engine;
  readonly #remote: Remote;
  readonly #evidence: EvidenceStore;
  readonly #github: ShareGitHub;
  readonly #now: () => number;
  readonly #hashes = new Map<string, HashedFile>();
  readonly #diffs = new Map<string, { key: string; file: PublishedFile | null }>();
  #pairedAs: string | null;

  constructor(options: SharePublisherOptions) {
    this.#engine = options.engine;
    this.#remote = options.remote;
    this.#evidence = options.evidence;
    this.#github = options.github ?? GITHUB;
    this.#now = options.now ?? Date.now;
    this.#pairedAs = this.#selectInstanceId();
    options.remote.subscribe(() => this.#syncPairing());
  }

  #selectInstanceId() {
    return this.#remote.store.file.credentials?.instanceId ?? null;
  }

  #syncPairing() {
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

  preview(taskId: string): SharePreview {
    const task = this.#findTask(taskId);
    const { shared } = this.#resolveShared(task);
    const files: Record<string, string> = {};
    for (const item of shared.evidence) {
      if (!item.uri.startsWith(SHARED_EVIDENCE_PREFIX)) continue;
      const original = this.#engine.state.evidence[item.id];
      if (original && this.#selectEvidencePath(item.id)) files[item.id] = original.uri;
    }
    if (shared.code) files[SHARE_DIFF_FILE] = resolveSharePreviewDiffApiPath(taskId);
    return {
      shared: { ...shared, evidence: shared.evidence.filter((item) => isListed(item, files)) },
      files,
      updatedAt: this.#now(),
    };
  }

  async previewDiff(taskId: string) {
    const task = this.#findTask(taskId);
    const { shared, repo } = this.#resolveShared(task);
    const [file] = await this.#listDiffFiles(shared, task, repo);
    if (!file) throw new DomainError('share_no_code', 'This task shares no code.');
    return new TextDecoder().decode(await file.read());
  }

  #findTask(taskId: string) {
    const task = this.#engine.state.tasks[taskId];
    if (!task) throw new DomainError('task_not_found', 'No such task.');
    return task;
  }

  #resolveShared(task: Task) {
    const repo = task.repoId ? (this.#engine.state.repos[task.repoId] ?? null) : null;
    const shared = resolveSharedTask(this.#engine.state, task, {
      owner: this.#remote.store.file.owner,
      machine: this.#remote.snapshot().machineName,
      repository: resolveRepositoryName(repo),
    });
    return { shared, repo };
  }

  async publish(taskId: string, context: EffectContext) {
    const task = this.#engine.state.tasks[taskId];
    if (!task?.share) return;
    const credentials = this.#findCredentials();
    const { shared, repo } = this.#resolveShared(task);
    const files = [
      ...(await this.#listEvidenceFiles(shared)),
      ...(await this.#listDiffFiles(shared, task, repo)),
    ].slice(0, PUBLICATION_LIMITS.files);
    try {
      await this.#upload(credentials, files);
      const answer = await this.#remote.control.writePublication(credentials.machineToken, taskId, {
        shared: { ...shared, evidence: shared.evidence.filter(isPublished(files)) },
        files: files.map((file) => ({ id: file.id, hash: file.hash })),
        newLink: task.share.url === null,
      });
      await this.#engine.dispatch(
        { type: 'share.record', taskId, url: answer.url },
        { id: `${context.key}:share.record` }
      );
    } catch (error) {
      throw resolveControlFailure(error);
    }
  }

  async remove(taskId: string) {
    const { credentials } = this.#remote.store.file;
    if (!credentials) return;
    try {
      await this.#remote.control.removePublication(credentials.machineToken, taskId);
    } catch (error) {
      throw resolveControlFailure(error);
    }
  }

  #findCredentials() {
    const { credentials } = this.#remote.store.file;
    if (!credentials) throw new EffectError(SHARE_NOT_PAIRED, SHARE_NOT_PAIRED, FINAL);
    return credentials;
  }

  async #listEvidenceFiles(shared: SharedTask) {
    const files: PublishedFile[] = [];
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
    const contentType = path ? FILE_TYPES[extname(path).toLowerCase()] : undefined;
    if (!path || !contentType) return null;
    const stat = statSync(path);
    if (stat.size > PUBLICATION_LIMITS.fileBytes) return null;
    return { path, contentType, stat };
  }

  async #resolveEvidenceFile(evidenceId: string): Promise<PublishedFile | null> {
    const selected = this.#selectEvidencePath(evidenceId);
    if (!selected) return null;
    const { path, contentType, stat } = selected;
    const read = async () => new Uint8Array(await Bun.file(path).arrayBuffer());
    return { id: evidenceId, hash: await this.#resolveFileHash(path, stat, read), contentType, read };
  }

  async #resolveFileHash(path: string, stat: { size: number; mtimeMs: number }, read: PublishedFile['read']) {
    const known = this.#hashes.get(path);
    if (known && known.size === stat.size && known.modifiedAt === stat.mtimeMs) return known.hash;
    const hash = resolveBytesHash(await read());
    this.#hashes.set(path, { size: stat.size, modifiedAt: stat.mtimeMs, hash });
    return hash;
  }

  async #listDiffFiles(shared: SharedTask, task: Task, repo: Repo | null) {
    const pullRequest = task.pullRequest;
    if (!(shared.code && repo && pullRequest)) return [];
    const key = `${pullRequest.number}:${pullRequest.headSha ?? ''}`;
    const cached = this.#diffs.get(task.id);
    if (cached && pullRequest.headSha && cached.key === key) return cached.file ? [cached.file] : [];
    const bytes = new TextEncoder().encode(await this.#github.readDiff(repo, pullRequest.number));
    const file = createDiffFile(bytes);
    this.#diffs.set(task.id, { key, file });
    return file ? [file] : [];
  }

  async #upload(credentials: MachineCredentials, files: readonly PublishedFile[]) {
    if (files.length === 0) return;
    const hashes = [...new Set(files.map((file) => file.hash))];
    const { missing } = await this.#remote.control.requestMissingFiles(credentials.machineToken, hashes);
    const wanted = new Set(missing);
    for (const file of files) {
      if (!wanted.delete(file.hash)) continue;
      await this.#remote.control.uploadFile(
        credentials.machineToken,
        file.hash,
        await file.read(),
        file.contentType
      );
    }
  }
}
