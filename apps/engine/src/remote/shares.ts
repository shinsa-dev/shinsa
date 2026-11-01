import { lstatSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { extname, join, sep } from 'node:path';
import {
  type ChatEntry,
  countShareTranscriptPages,
  createShareWelcome,
  DomainError,
  deriveShareSessionKey,
  hasShareGroup,
  isShareId,
  type PullRequest,
  parseShareHello,
  parseShareUrl,
  parseUnifiedDiff,
  type Repo,
  redactTranscriptPage,
  resolveRoundBase,
  resolveSharedTask,
  resolveSharePreset,
  resolveShareTranscriptFile,
  SHARE_CODE_FILE,
  SHARE_DIFF_FILE,
  SHARE_FILE_BYTES,
  SHARE_ID_BYTES,
  SHARE_KEY_BYTES,
  SHARE_TRANSCRIPT_PAGE,
  SHARED_EVIDENCE_PREFIX,
  type SharedTask,
  type ShareFileType,
  type ShareLiveView,
  type SharePreset,
  serializeBase64Url,
  serializePublicKey,
  serializeShareUrl,
  type Task,
  verifyShareHello,
} from '@shinsa/core';
import { readWorkingPatch } from '../git/diff.ts';
import { resolveTaskCheckout, resolveTaskRefs } from '../git/task-refs.ts';
import { readPullRequestDiff, readRepoFile, resolveRepoSlug } from '../github/index.ts';
import { describeError, log } from '../log/index.ts';
import type { EffectContext, Engine } from '../runtime/engine.ts';
import { EffectError } from '../runtime/failures.ts';
import { EVIDENCE_ROUTE, type EvidenceStore } from '../store/evidence.ts';
import type { ChannelPeer } from './channel.ts';
import type { Remote } from './index.ts';
import {
  createChannelEphemeral,
  type HelloAnswer,
  type LiveFile,
  type LiveShare,
  SHARE_GONE_REASON,
  ShareChannel,
} from './share-channel.ts';
import { resolveOwnerProfile } from './store.ts';

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

export interface ShareWorktree {
  readBase: (repo: Repo, task: Task) => Promise<string>;
  readPatch: (worktree: string, base: string) => Promise<string>;
  readFile: (worktree: string, path: string) => Promise<string>;
}

export interface ShareTranscripts {
  listEntries: (runId: string) => ChatEntry[];
  subscribe: (listener: (runId: string) => void) => () => void;
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
  transcripts: ShareTranscripts;
  github?: ShareGitHub;
  worktree?: ShareWorktree;
  now?: () => number;
  random?: (bytes: number) => Uint8Array<ArrayBuffer>;
}

interface HashedFile {
  size: number;
  modifiedAt: number;
  hash: string;
}

const GITHUB: ShareGitHub = { readDiff: readPullRequestDiff, readFile: readRepoFile };

const WORKTREE: ShareWorktree = {
  readBase: async (repo, task) => {
    const refs = await resolveTaskRefs(repo, task, resolveRoundBase(task));
    return refs.base ?? refs.head;
  },
  readPatch: readWorkingPatch,
  readFile: readWorktreeFile,
};

const PULL_REQUEST_CODE: ReadonlySet<PullRequest['state']> = new Set(['open', 'merged']);

const CODE_FILE_LIMIT = 300;

const CODE_STATUSES: ReadonlySet<string> = new Set(['modified', 'renamed']);

export function readWorktreeFile(worktree: string, path: string) {
  const root = realpathSync(worktree);
  const full = join(root, path);
  if (lstatSync(full).isSymbolicLink()) return Promise.resolve(readlinkSync(full));
  const real = realpathSync(full);
  if (!real.startsWith(`${root}${sep}`)) {
    return Promise.reject(new Error(`${path} leads outside the working copy.`));
  }
  return Bun.file(real).text();
}

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

function encodeTranscript(entries: ChatEntry[]) {
  const encoder = new TextEncoder();
  let kept = entries;
  let bytes = encoder.encode(JSON.stringify(kept));
  while (bytes.byteLength > SHARE_FILE_BYTES && kept.length > 0) {
    kept = kept.slice(Math.ceil(kept.length / 4));
    bytes = encoder.encode(JSON.stringify(kept));
  }
  return bytes;
}

export class Shares implements ShareEffects, ShareLinks {
  readonly #engine: Engine;
  readonly #remote: Remote;
  readonly #evidence: EvidenceStore;
  readonly #transcripts: ShareTranscripts;
  readonly #github: ShareGitHub;
  readonly #worktree: ShareWorktree;
  readonly #now: () => number;
  readonly #random: (bytes: number) => Uint8Array<ArrayBuffer>;
  readonly #hashes = new Map<string, HashedFile>();
  readonly #code = new Map<string, { key: string; files: LiveFile[] }>();
  readonly #channels = new Map<ShareChannel, string>();
  #pairedAs: string | null;

  constructor(options: SharesOptions) {
    this.#engine = options.engine;
    this.#remote = options.remote;
    this.#evidence = options.evidence;
    this.#transcripts = options.transcripts;
    this.#github = options.github ?? GITHUB;
    this.#worktree = options.worktree ?? WORKTREE;
    this.#now = options.now ?? Date.now;
    this.#random = options.random ?? createRandom;
    this.#pairedAs = this.#selectInstanceId();
    options.remote.subscribe(() => this.#syncRemote());
    options.engine.subscribe(() => this.#syncChannels());
    options.transcripts.subscribe((runId) => this.#pushTranscript(runId));
  }

  #pushTranscript(runId: string) {
    const taskId = this.#engine.state.runs[runId]?.taskId;
    const preset = taskId ? this.#engine.state.tasks[taskId]?.share?.preset : undefined;
    if (!(taskId && preset && hasShareGroup(preset, 'live'))) return;
    for (const channel of this.#channels.keys()) if (channel.subject === taskId) void channel.push();
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
      (channel, shareId) =>
        channel.subject !== null && this.#resolveShare(shareId)?.taskId !== channel.subject,
      SHARE_GONE_REASON
    );
    for (const channel of this.#channels.keys()) if (channel.subject) void channel.push();
  }

  #endChannels(match: (channel: ShareChannel, shareId: string) => boolean, reason: string) {
    for (const [channel, shareId] of [...this.#channels]) {
      if (!match(channel, shareId)) continue;
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
    const channel = new ShareChannel<string>(peer, {
      name: 'share link',
      authorize: (hello) => this.#authorize(hello, shareId),
      resolveLive: (taskId) => this.resolveLive(taskId),
    });
    this.#channels.set(channel, shareId);
    return channel;
  }

  async #authorize(text: string, shareId: string): Promise<HelloAnswer<string>> {
    const hello = parseShareHello(text);
    if (hello?.share !== shareId) return null;
    const share = this.#resolveShare(shareId);
    if (!(share && (await verifyShareHello(share.key, hello)))) return { refused: SHARE_GONE_REASON };
    const ephemeral = await createChannelEphemeral();
    const keys = {
      share: shareId,
      clientEphemeral: hello.ephemeral,
      serverEphemeral: await serializePublicKey(ephemeral.publicKey),
    };
    return {
      subject: share.taskId,
      session: await deriveShareSessionKey(share.key, keys, ephemeral.privateKey, hello.ephemeral),
      welcome: await createShareWelcome(share.key, keys),
    };
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

  async resolveLive(taskId: string, preset?: SharePreset): Promise<LiveShare<ShareLiveView>> {
    const task = this.#findTask(taskId);
    const { shared, repo } = this.#resolveShared(task, preset);
    const files = [
      ...(await this.#listEvidenceFiles(shared)),
      ...(await this.#listLiveCodeFiles(shared, task, repo)),
      ...this.#listTranscriptFiles(shared),
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

  #resolveShared(task: Task, chosen?: SharePreset) {
    const preset = chosen ?? task.share?.preset ?? resolveSharePreset(this.#engine.state.settings);
    const people = hasShareGroup(preset, 'people');
    const repo = people && task.repoId ? (this.#engine.state.repos[task.repoId] ?? null) : null;
    const shared = resolveSharedTask(this.#engine.state, task, {
      preset,
      owner: people ? this.#remote.store.file.owner : null,
      ownerProfile: people ? resolveOwnerProfile(this.#remote.store.file) : null,
      machine: people ? this.#remote.snapshot().machineName : null,
      repository: resolveRepositoryName(repo),
    });
    return { shared, repo };
  }

  #listTranscriptFiles(shared: SharedTask) {
    if (!hasShareGroup(shared.preset, 'live')) return [];
    const messages = hasShareGroup(shared.preset, 'messages');
    return shared.runs.flatMap((run) => this.#listTranscriptPages(run.id, messages));
  }

  #listTranscriptPages(runId: string, messages: boolean): LiveFile[] {
    const count = this.#transcripts.listEntries(runId).length;
    const scope = messages ? 'messages' : 'agents';
    return Array.from({ length: countShareTranscriptPages(count) }, (_, page) => ({
      id: resolveShareTranscriptFile(runId, page),
      version: `${scope}:${Math.min(count - page * SHARE_TRANSCRIPT_PAGE, SHARE_TRANSCRIPT_PAGE)}`,
      type: 'text/plain',
      read: async () =>
        encodeTranscript(redactTranscriptPage(this.#transcripts.listEntries(runId), page, messages)),
    }));
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
      log.warn('[Share] Could not read the task’s code', { taskId: task.id, error: describeError(error) });
      return [];
    }
  }

  #listCodeFiles(shared: SharedTask, task: Task, repo: Repo | null) {
    if (!(shared.code && repo)) return Promise.resolve([]);
    const pullRequest = task.pullRequest;
    if (pullRequest && PULL_REQUEST_CODE.has(pullRequest.state))
      return this.#listPullRequestFiles(task, repo, pullRequest);
    const worktree = resolveTaskCheckout(task);
    return worktree ? this.#listWorkingFiles(task, repo, worktree) : Promise.resolve([]);
  }

  #listPullRequestFiles(task: Task, repo: Repo, pullRequest: PullRequest) {
    const key = `${pullRequest.number}:${pullRequest.headSha ?? ''}`;
    const head = pullRequest.headSha;
    return this.#cacheCode(
      task.id,
      key,
      () => this.#github.readDiff(repo, pullRequest.number),
      (path) => {
        if (!head) return null;
        return this.#github.readFile(repo, head, path);
      }
    );
  }

  #listWorkingFiles(task: Task, repo: Repo, worktree: string) {
    return this.#cacheCode(
      task.id,
      `working:${task.updatedAt}:${this.#countToolResults(task.id)}`,
      async () => this.#worktree.readPatch(worktree, await this.#worktree.readBase(repo, task)),
      (path) => this.#worktree.readFile(worktree, path)
    );
  }

  #countToolResults(taskId: string) {
    let count = 0;
    for (const run of Object.values(this.#engine.state.runs)) {
      if (run.taskId !== taskId) continue;
      for (const entry of this.#transcripts.listEntries(run.id)) if (entry.type === 'tool_result') count += 1;
    }
    return count;
  }

  async #cacheCode(
    taskId: string,
    key: string,
    readDiff: () => Promise<string>,
    readFile: (path: string) => Promise<string> | null
  ) {
    const cached = this.#code.get(taskId);
    if (cached?.key === key) return cached.files;
    const diff = await readDiff();
    const encoder = new TextEncoder();
    const diffFile = createTextFile(SHARE_DIFF_FILE, key, encoder.encode(diff));
    let codeFile: LiveFile | null = null;
    if (diffFile) {
      const code = await this.#readChangedFiles(diff, readFile);
      if (code) codeFile = createTextFile(SHARE_CODE_FILE, key, encoder.encode(JSON.stringify(code)));
    }
    const files = [diffFile, codeFile].flatMap((file) => file ?? []);
    this.#code.set(taskId, { key, files });
    return files;
  }

  async #readChangedFiles(
    diff: string,
    readFile: (path: string) => Promise<string> | null
  ): Promise<SharedCode | null> {
    const files: Record<string, string> = {};
    let bytes = 0;
    const changed = parseUnifiedDiff(diff).filter((file) => CODE_STATUSES.has(file.status) && !file.binary);
    for (const file of changed.slice(0, CODE_FILE_LIMIT)) {
      const reading = readFile(file.path);
      if (!reading) return null;
      try {
        const content = await reading;
        bytes += content.length;
        if (bytes > SHARE_FILE_BYTES) break;
        files[file.path] = content;
      } catch (error) {
        log.warn('[Share] Could not read a changed file', { path: file.path, error: describeError(error) });
      }
    }
    return { files };
  }
}
