import { statSync } from 'node:fs';
import { extname } from 'node:path';
import {
  type Bytes,
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
  type ShareLiveView,
  type SharePreset,
  serializeBase64Url,
  serializePublicKey,
  serializeShareUrl,
  type Task,
  verifyShareHello,
} from '@shinsa/core';
import { Effect, Option, Ref } from 'effect';
import { History } from '../../git/history/service.ts';
import { resolveTaskCheckout } from '../../git/task-refs.ts';
import { resolveRepoSlug } from '../../github/index.ts';
import { PullRequests } from '../../github/pulls/service.ts';
import { describeError } from '../../log/index.ts';
import type { EffectContext } from '../../runtime/engine.ts';
import { createFinalFailure } from '../../runtime/failures/classify.ts';
import { EVIDENCE_ROUTE } from '../../store/evidence/index.ts';
import type { ChannelPeer } from '../channel.ts';
import { createChannelEphemeral, SHARE_GONE_REASON, type ShareChannel } from '../share-channel.ts';
import { resolveOwnerProfile } from '../store.ts';
import {
  type CachedCode,
  CODE_FILE_LIMIT,
  CODE_STATUSES,
  type HashedFile,
  type OpenShareChannel,
  PULL_REQUEST_CODE,
  SHARE_FILE_TYPES,
  SHARE_LINK_LOST,
  SHARE_NOT_PAIRED,
  SHARE_REMOTE_CHANGED,
  type ShareCodeSource,
  ShareCodeUnreadable,
  type SharedCode,
  type ShareFile,
  ShareFileUnreadable,
  type ShareLive,
  type SharesDefinition,
  type SharesHandle,
  type ShareWorkingSource,
} from './schema.ts';
import { readWorktreeFile } from './worktree-file.ts';

export const makeShares = Effect.fn('Shares.make')(function* (definition: SharesDefinition) {
  const pulls = yield* PullRequests;
  const history = yield* History;
  const hashes = yield* Ref.make<ReadonlyMap<string, HashedFile>>(new Map());
  const code = yield* Ref.make<ReadonlyMap<string, CachedCode>>(new Map());
  const channels = yield* Ref.make<ReadonlyMap<ShareChannel, OpenShareChannel>>(new Map());
  const pairedAs = yield* Ref.make((yield* definition.remoteFile).credentials?.instanceId ?? null);

  const unreadable = (failure: { readonly message: string }) =>
    new ShareCodeUnreadable({ message: failure.message });

  const github: ShareCodeSource = definition.github ?? {
    readDiff: (repo, number) => pulls.readDiff(repo, number).pipe(Effect.mapError(unreadable)),
    readFile: (repo, ref, path) => pulls.readFile(repo, ref, path).pipe(Effect.mapError(unreadable)),
  };

  const worktree: ShareWorkingSource = definition.worktree ?? {
    readBase: (repo, task) =>
      history.taskRefs(repo, task, resolveRoundBase(task)).pipe(
        Effect.map((refs) => refs.base ?? refs.head),
        Effect.mapError(unreadable)
      ),
    readPatch: (path, base) => history.workingPatch(path, base).pipe(Effect.mapError(unreadable)),
    readFile: readWorktreeFile,
  };

  const forkChannel = (run: () => Promise<void>) =>
    Effect.asVoid(Effect.forkDetach(Effect.promise(run), { startImmediately: true }));

  const selectInstanceId = Effect.map(definition.remoteFile, (file) => file.credentials?.instanceId ?? null);

  const resolveShare = Effect.fn('Shares.resolveShare')(function* (shareId: string) {
    const instanceId = yield* selectInstanceId;
    if (!instanceId) return null;
    const now = yield* definition.now;
    for (const task of Object.values((yield* definition.state).tasks)) {
      if ((task.share?.endsAt ?? Number.POSITIVE_INFINITY) <= now) continue;
      const link = parseShareUrl(task.share?.url ?? null);
      if (link?.shareId === shareId && link.instanceId === instanceId)
        return { taskId: task.id, key: link.key };
    }
    return null;
  });

  const releaseChannel = Effect.fn('Shares.releaseChannel')(function* (channel: ShareChannel) {
    const entry = yield* Ref.modify(channels, (open) => {
      const rest = new Map(open);
      rest.delete(channel);
      return [open.get(channel), rest] as const;
    });
    if (entry) yield* entry.release;
  });

  const pushTranscript = Effect.fn('Shares.pushTranscript')(function* (runId: string) {
    const state = yield* definition.state;
    const taskId = state.runs[runId]?.taskId;
    const preset = taskId ? state.tasks[taskId]?.share?.preset : undefined;
    if (!(taskId && preset && hasShareGroup(preset, 'live'))) return;
    for (const channel of (yield* Ref.get(channels)).keys())
      if (channel.subject === taskId) yield* forkChannel(() => channel.push());
  });

  const syncRemote = Effect.gen(function* () {
    const now = yield* selectInstanceId;
    const before = yield* Ref.getAndSet(pairedAs, now);
    if (before === null || before === now) return;
    for (const task of Object.values((yield* definition.state).tasks)) {
      if (!task.share?.url || task.share.failure) continue;
      yield* Effect.forkDetach(
        definition
          .dispatch({ type: 'share.fail', taskId: task.id, detail: SHARE_LINK_LOST })
          .pipe(
            Effect.catch((failure) =>
              Effect.logError('[Share] Could not mark a link as lost').pipe(
                Effect.annotateLogs({ taskId: task.id, error: failure.message })
              )
            )
          ),
        { startImmediately: true }
      );
    }
  });

  const syncChannels = Effect.gen(function* () {
    for (const [channel, { shareId }] of yield* Ref.get(channels)) {
      if (channel.subject === null || (yield* resolveShare(shareId))?.taskId === channel.subject) continue;
      yield* releaseChannel(channel);
      yield* forkChannel(() => channel.end(SHARE_GONE_REASON));
    }
    for (const channel of (yield* Ref.get(channels)).keys())
      if (channel.subject) yield* forkChannel(() => channel.push());
  });

  const acceptsShare = (shareId: string) =>
    Effect.map(definition.remoteEnabled, (enabled) => enabled && isShareId(shareId));

  const authorize = Effect.fn('Shares.authorize')(function* (text: string, shareId: string) {
    const hello = parseShareHello(text);
    if (hello?.share !== shareId) return null;
    const share = yield* resolveShare(shareId);
    if (!(share && (yield* Effect.promise(() => verifyShareHello(share.key, hello)))))
      return { refused: SHARE_GONE_REASON };
    const ephemeral = yield* Effect.promise(createChannelEphemeral);
    const keys = {
      share: shareId,
      clientEphemeral: hello.ephemeral,
      serverEphemeral: yield* Effect.promise(() => serializePublicKey(ephemeral.publicKey)),
    };
    return {
      subject: share.taskId,
      session: yield* Effect.promise(() =>
        deriveShareSessionKey(share.key, keys, ephemeral.privateKey, hello.ephemeral)
      ),
      welcome: yield* Effect.promise(() => createShareWelcome(share.key, keys)),
    };
  });

  const openChannel = Effect.fn('Shares.openChannel')(function* (peer: ChannelPeer, shareId: string) {
    const channel = yield* definition.createChannel(peer, (hello) => authorize(hello, shareId));
    const release = yield* definition.acquireAccess(
      Effect.gen(function* () {
        const open = yield* Ref.modify(channels, (current) => {
          const rest = new Map(current);
          return [rest.delete(channel), rest] as const;
        });
        if (open) yield* forkChannel(() => channel.end(SHARE_REMOTE_CHANGED));
      })
    );
    yield* Ref.update(channels, (open) => new Map(open).set(channel, { shareId, release }));
    return channel;
  });

  const closeChannel = Effect.fn('Shares.closeChannel')(function* (channel: ShareChannel) {
    yield* Effect.sync(() => channel.close());
    yield* releaseChannel(channel);
  });

  const link = Effect.fn('Shares.link')(function* (taskId: string, context: EffectContext) {
    const task = (yield* definition.state).tasks[taskId];
    if (!task?.share) return;
    const credentials = (yield* definition.remoteFile).credentials;
    if (!credentials) return yield* createFinalFailure(SHARE_NOT_PAIRED);
    const current = parseShareUrl(task.share.url);
    const url =
      current?.instanceId === credentials.instanceId
        ? null
        : serializeShareUrl(yield* definition.appOrigin, {
            instanceId: credentials.instanceId,
            shareId: serializeBase64Url(yield* definition.random(SHARE_ID_BYTES)),
            key: serializeBase64Url(yield* definition.random(SHARE_KEY_BYTES)),
          });
    yield* definition.dispatch({ type: 'share.record', taskId, url }, `${context.key}:share.record`);
  });

  const createTextFile = (id: string, version: string, bytes: Bytes): ShareFile | null => {
    if (bytes.byteLength > SHARE_FILE_BYTES) return null;
    return { id, version, type: 'text/plain', read: Effect.succeed(bytes) };
  };

  const encodeTranscript = (entries: ChatEntry[]) => {
    const encoder = new TextEncoder();
    let kept = entries;
    let bytes = encoder.encode(JSON.stringify(kept));
    while (bytes.byteLength > SHARE_FILE_BYTES && kept.length > 0) {
      kept = kept.slice(Math.ceil(kept.length / 4));
      bytes = encoder.encode(JSON.stringify(kept));
    }
    return bytes;
  };

  const resolveShared = Effect.fn('Shares.resolveShared')(function* (task: Task, chosen?: SharePreset) {
    const state = yield* definition.state;
    const file = yield* definition.remoteFile;
    const preset = chosen ?? task.share?.preset ?? resolveSharePreset(state.settings);
    const people = hasShareGroup(preset, 'people');
    const repo = people && task.repoId ? (state.repos[task.repoId] ?? null) : null;
    const slug = repo ? resolveRepoSlug(repo) : null;
    const shared = resolveSharedTask(state, task, {
      preset,
      owner: people ? file.owner : null,
      ownerProfile: people ? resolveOwnerProfile(file) : null,
      machine: people ? yield* definition.machineName : null,
      repository: slug ? `${slug.owner}/${slug.name}` : (repo?.name ?? null),
    });
    return { shared, repo };
  });

  const listTranscriptPages = Effect.fn('Shares.listTranscriptPages')(function* (
    runId: string,
    messages: boolean
  ) {
    const count = (yield* definition.listEntries(runId)).length;
    const scope = messages ? 'messages' : 'agents';
    return Array.from({ length: countShareTranscriptPages(count) }, (_, page): ShareFile => ({
      id: resolveShareTranscriptFile(runId, page),
      version: `${scope}:${Math.min(count - page * SHARE_TRANSCRIPT_PAGE, SHARE_TRANSCRIPT_PAGE)}`,
      type: 'text/plain',
      read: Effect.map(definition.listEntries(runId), (entries) =>
        encodeTranscript(redactTranscriptPage(entries, page, messages))
      ),
    }));
  });

  const listTranscriptFiles = Effect.fn('Shares.listTranscriptFiles')(function* (shared: SharedTask) {
    if (!hasShareGroup(shared.preset, 'live')) return [];
    const messages = hasShareGroup(shared.preset, 'messages');
    const pages = yield* Effect.forEach(shared.runs, (run) => listTranscriptPages(run.id, messages));
    return pages.flat();
  });

  const resolveFileHash = Effect.fn('Shares.resolveFileHash')(function* (
    path: string,
    stat: { size: number; mtimeMs: number },
    read: ShareFile['read']
  ) {
    const known = (yield* Ref.get(hashes)).get(path);
    if (known && known.size === stat.size && known.modifiedAt === stat.mtimeMs) return known.hash;
    const bytes = yield* read;
    const hash = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
    yield* Ref.update(hashes, (seen) =>
      new Map(seen).set(path, { size: stat.size, modifiedAt: stat.mtimeMs, hash })
    );
    return hash;
  });

  const resolveEvidenceFile = Effect.fn('Shares.resolveEvidenceFile')(function* (evidenceId: string) {
    const original = (yield* definition.state).evidence[evidenceId];
    if (!original?.uri.startsWith(EVIDENCE_ROUTE)) return null;
    const path = yield* definition.selectEvidenceFile(original.uri.slice(EVIDENCE_ROUTE.length));
    const type = path ? SHARE_FILE_TYPES[extname(path).toLowerCase()] : undefined;
    if (!path || !type) return null;
    const stat = yield* Effect.option(Effect.try(() => statSync(path)));
    if (Option.isNone(stat) || stat.value.size > SHARE_FILE_BYTES) return null;
    const read = Effect.tryPromise({
      try: () => Bun.file(path).arrayBuffer(),
      catch: (error) => new ShareFileUnreadable({ path, message: describeError(error) }),
    }).pipe(Effect.map((buffer): Bytes => new Uint8Array(buffer)));
    const version = yield* Effect.option(resolveFileHash(path, stat.value, read));
    if (Option.isNone(version)) return null;
    const file: ShareFile = { id: evidenceId, version: version.value, type, read };
    return file;
  });

  const listEvidenceFiles = Effect.fn('Shares.listEvidenceFiles')(function* (shared: SharedTask) {
    const files: ShareFile[] = [];
    for (const item of shared.evidence) {
      if (!item.uri.startsWith(SHARED_EVIDENCE_PREFIX)) continue;
      const file = yield* resolveEvidenceFile(item.id);
      if (file) files.push(file);
    }
    return files;
  });

  const readChangedFiles = Effect.fn('Shares.readChangedFiles')(function* (
    diff: string,
    readFile: ((path: string) => Effect.Effect<string, ShareCodeUnreadable>) | null
  ) {
    const files: Record<string, string> = {};
    let bytes = 0;
    const changed = parseUnifiedDiff(diff).filter((file) => CODE_STATUSES.has(file.status) && !file.binary);
    for (const file of changed.slice(0, CODE_FILE_LIMIT)) {
      if (!readFile) return null;
      const content = yield* readFile(file.path).pipe(
        Effect.map(Option.some),
        Effect.catch((failure) =>
          Effect.logWarning('[Share] Could not read a changed file').pipe(
            Effect.annotateLogs({ path: file.path, error: failure.message }),
            Effect.as(Option.none<string>())
          )
        )
      );
      if (Option.isNone(content)) continue;
      bytes += content.value.length;
      if (bytes > SHARE_FILE_BYTES) break;
      files[file.path] = content.value;
    }
    const shared: SharedCode = { files };
    return shared;
  });

  const cacheCode = Effect.fn('Shares.cacheCode')(function* (
    taskId: string,
    key: string,
    readDiff: Effect.Effect<string, ShareCodeUnreadable>,
    readFile: ((path: string) => Effect.Effect<string, ShareCodeUnreadable>) | null
  ) {
    const cached = (yield* Ref.get(code)).get(taskId);
    if (cached?.key === key) return cached.files;
    const diff = yield* readDiff;
    const encoder = new TextEncoder();
    const diffFile = createTextFile(SHARE_DIFF_FILE, key, encoder.encode(diff));
    const changed = diffFile ? yield* readChangedFiles(diff, readFile) : null;
    const codeFile = changed
      ? createTextFile(SHARE_CODE_FILE, key, encoder.encode(JSON.stringify(changed)))
      : null;
    const files = [diffFile, codeFile].flatMap((file) => file ?? []);
    yield* Ref.update(code, (known) => new Map(known).set(taskId, { key, files }));
    return files;
  });

  const listPullRequestFiles = (task: Task, repo: Repo, pullRequest: PullRequest) => {
    const head = pullRequest.headSha;
    return cacheCode(
      task.id,
      `${pullRequest.number}:${head ?? ''}`,
      github.readDiff(repo, pullRequest.number),
      head ? (path) => github.readFile(repo, head, path) : null
    );
  };

  const countToolResults = Effect.fn('Shares.countToolResults')(function* (taskId: string) {
    let count = 0;
    for (const run of Object.values((yield* definition.state).runs)) {
      if (run.taskId !== taskId) continue;
      for (const entry of yield* definition.listEntries(run.id)) if (entry.type === 'tool_result') count += 1;
    }
    return count;
  });

  const listWorkingFiles = Effect.fn('Shares.listWorkingFiles')(function* (
    task: Task,
    repo: Repo,
    checkout: string
  ) {
    return yield* cacheCode(
      task.id,
      `working:${task.updatedAt}:${yield* countToolResults(task.id)}`,
      Effect.flatMap(worktree.readBase(repo, task), (base) => worktree.readPatch(checkout, base)),
      (path) => worktree.readFile(checkout, path)
    );
  });

  const listCodeFiles = Effect.fn('Shares.listCodeFiles')(function* (
    shared: SharedTask,
    task: Task,
    repo: Repo | null
  ) {
    if (!(shared.code && repo)) return [];
    const pullRequest = task.pullRequest;
    if (pullRequest && PULL_REQUEST_CODE.has(pullRequest.state))
      return yield* listPullRequestFiles(task, repo, pullRequest);
    const checkout = resolveTaskCheckout(task);
    return checkout ? yield* listWorkingFiles(task, repo, checkout) : [];
  });

  const listLiveCodeFiles = (shared: SharedTask, task: Task, repo: Repo | null) =>
    listCodeFiles(shared, task, repo).pipe(
      Effect.catch((failure) =>
        Effect.logWarning('[Share] Could not read the task’s code').pipe(
          Effect.annotateLogs({ taskId: task.id, error: failure.message }),
          Effect.as([])
        )
      )
    );

  const resolveLive = Effect.fn('Shares.resolveLive')(function* (taskId: string, preset?: SharePreset) {
    const task = (yield* definition.state).tasks[taskId];
    if (!task) return yield* new DomainError({ code: 'task_not_found', message: 'No such task.' });
    const { shared, repo } = yield* resolveShared(task, preset);
    const files = [
      ...(yield* listEvidenceFiles(shared)),
      ...(yield* listLiveCodeFiles(shared, task, repo)),
      ...(yield* listTranscriptFiles(shared)),
    ];
    const listed = new Set(files.map((file) => file.id));
    const view: ShareLiveView = {
      shared: {
        ...shared,
        evidence: shared.evidence.filter(
          (item) => !item.uri.startsWith(SHARED_EVIDENCE_PREFIX) || listed.has(item.id)
        ),
      },
      files: Object.fromEntries(files.map((file) => [file.id, { version: file.version, type: file.type }])),
      updatedAt: yield* definition.now,
    };
    const live: ShareLive = { view, files };
    return live;
  });

  const handle: SharesHandle = {
    syncRemote,
    syncChannels,
    pushTranscript,
    acceptsShare,
    openChannel,
    closeChannel,
    link,
    resolveLive,
  };
  return handle;
});
