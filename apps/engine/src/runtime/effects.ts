import { rmSync } from 'node:fs';
import {
  type BundleConflict,
  type CheckEvidence,
  type Coverage,
  evaluatePullRequestWatch,
  isBlockingCheck,
  isSamePullRequest,
  isSamePullRequestWatch,
  isTaskSettled,
  listBundleAbove,
  listBundleBelow,
  listStackedPullRequests,
  listTaskChecks,
  needsRepository,
  needsWorktree,
  type PullRequest,
  type PullRequestCloseFailure,
  type Repo,
  type RepoCi,
  type RoundPullRequest,
  resolveCurrentRound,
  resolvePullRequestCi,
  resolveRoundBase,
  resolveTaskPipeline,
  resolveTaskWorkspace,
  type ShinsaEffect,
  type ShippingStep,
  type ShippingStepKind,
  type Task,
} from '@shinsa/core';
import type { RunSupervisor } from '../agents/supervisor.ts';
import type { Briefings } from '../briefing/index.ts';
import { BaseCheckouts } from '../checks/base.ts';
import { pruneSharedCaches, resolveSharedCacheEnv } from '../checks/caches.ts';
import { serializeCheckOutput } from '../checks/evidence.ts';
import { listCheckFailures } from '../checks/failures.ts';
import { type BaseComparison, CHECK_TIMEOUT_MS, type CheckRun, runChecks } from '../checks/index.ts';
import { resolveScratchPath, type ServerConfig } from '../config/index.ts';
import type { FeedbackDrafter } from '../feedback/draft.ts';
import { listFeedbackEnvironment, resolveFeedbackMachine } from '../feedback/environment.ts';
import { FeedbackEffects } from '../feedback/index.ts';
import {
  type BundleBranch,
  checkBundleMerge,
  hasPrePushHook,
  PushError,
  removeIsolatedWorktrees,
  resolveOutputTail,
  syncRemoteBranch,
} from '../git/index.ts';
import { stopProcessesIn } from '../git/processes.ts';
import { resolveTaskRefs } from '../git/task-refs.ts';
import { RepoCiCache } from '../github/ci.ts';
import { PullRequestDescriptions } from '../github/description.ts';
import {
  closePullRequest,
  createPullRequest,
  mergePullRequest,
  type PullRequestRead,
  readPullRequest,
  readStackedPullRequest,
  retargetPullRequest,
  writePullRequestBlock,
} from '../github/index.ts';
import { BUNDLE } from '../instance/bundle.ts';
import { createServerInstance, type ServerInstance } from '../instance/install.ts';
import { describeError, log } from '../log/index.ts';
import type { PreviewEffects } from '../remote/previews.ts';
import type { ShareDescriber } from '../remote/share-describe.ts';
import type { ShareEffects } from '../remote/shares.ts';
import {
  createLoginResolver,
  type LoginResolver,
  listCandidateRepos,
  type RootSource,
  syncRepoRemote,
  upsertRepo,
  verifySetup,
} from '../repos/index.ts';
import type { ProcessTracker } from '../resources/index.ts';
import type { WatchWriter } from '../schedules/suggest.ts';
import type { Slack } from '../slack/index.ts';
import { EvidenceStore } from '../store/evidence.ts';
import { measureTaskCoverage } from '../test-coverage/index.ts';
import { resolveRepoProject, type TriageResolver } from '../triage/index.ts';
import type { RepositoryFinder } from '../triage/message.ts';
import { describeWorkspaceProblem, Workspaces } from '../workspaces/index.ts';
import type { EffectContext, EffectRetry, Engine } from './engine.ts';
import { resolveShippingError } from './failures.ts';

export interface EffectRunnerOptions {
  triage: TriageResolver;
  wordWatch?: WatchWriter;
  describeShare?: ShareDescriber;
  draftFeedback?: FeedbackDrafter;
  instance?: Pick<ServerInstance, 'version' | 'commit'>;
  timeZone?: string;
  findRepository?: RepositoryFinder;
  resolveLogin?: LoginResolver;
  roots?: RootSource;
  watchIntervalMs?: number;
  workspaces?: Workspaces;
  services?: TaskServices;
  shares: ShareEffects;
  previews: PreviewEffects;
  slack?: Slack;
  trackProcess?: ProcessTracker;
}

export interface TaskServices {
  closeTaskServices(taskId: string): void;
  listTerminalPids(): number[];
}

const WATCH_INTERVAL_MS = 45_000;

type ChecksEffect = Extract<ShinsaEffect, { kind: 'checks.run' }>;

type SuggestEffect = Extract<ShinsaEffect, { kind: 'watch.suggest' }>;

type MergeEffect = Extract<ShinsaEffect, { kind: 'pull_request.merge' }>;

type CloseEffect = Extract<ShinsaEffect, { kind: 'pull_request.close' }>;

const CANCELLED_COMMENT = 'Closed because its task was cancelled in Shinsa.';

const FAILURE_TITLE: Partial<Record<ShinsaEffect['kind'], string>> = {
  'task.triage': 'Could not start the task',
  'config.verify': 'Could not verify the setup',
  'worktree.create': 'Could not set up the worktree',
  'checks.run': 'Could not run the checks',
  'pull_request.open': 'Could not open the pull request',
  'pull_request.push': 'Could not push the fixes',
  'pull_request.merge': 'Could not merge the pull request',
};

const NO_TRIAGE = 'Shinsa could not read the request, so the task has no title or kind of work yet.';

const RATE_LIMITED = /rate limit|HTTP 429/i;

const NOT_MERGED_YET =
  'GitHub still shows the pull request as open after merging it. Retry to check it again and merge it.';

function needsMerge(pullRequest: PullRequest | undefined) {
  return pullRequest?.state !== 'merged' && !pullRequest?.mergeQueue;
}

function isAwaitingMerge(pullRequest: PullRequest) {
  return pullRequest.state === 'open' && !pullRequest.mergeQueue;
}

function isHeadMoved(headSha: string | null, pullRequest: PullRequest) {
  return Boolean(headSha && pullRequest.headSha && pullRequest.headSha !== headSha);
}

function hasPullRequestNews(task: Task, read: PullRequestRead, ci: RepoCi) {
  if ((task.pullRequestReadFailures ?? 0) > 0) return true;
  if (!isSamePullRequest(task.pullRequest, read.pullRequest)) return true;
  const watch = task.pullRequestWatch;
  if (!watch) return true;
  const report = evaluatePullRequestWatch(
    watch,
    read.pullRequest,
    read.remarks,
    read.viewer,
    resolvePullRequestCi(task, watch, ci, Date.now())
  );
  return report.changes.length > 0 || !isSamePullRequestWatch(report.next, watch);
}

export class EffectRunner {
  readonly #engine: Engine;
  readonly #config: ServerConfig;
  readonly #runs: RunSupervisor;
  readonly #briefings: Briefings;
  readonly #triageTask: TriageResolver;
  readonly #wordWatch: WatchWriter;
  readonly #describeShare: ShareDescriber;
  readonly #timeZone: string;
  readonly #findRepository: RepositoryFinder;
  readonly #resolveLogin: LoginResolver;
  readonly #roots: RootSource;
  readonly #watchIntervalMs: number;
  readonly #workspaces: Workspaces;
  readonly #services: TaskServices | null;
  readonly #shares: ShareEffects;
  readonly #previews: PreviewEffects;
  readonly #slack: Slack | null;
  readonly #trackProcess: ProcessTracker | null;
  readonly #feedback: FeedbackEffects;
  readonly #evidence: EvidenceStore;
  readonly #descriptions: PullRequestDescriptions;
  readonly #bases: BaseCheckouts;
  readonly #ci = new RepoCiCache();
  readonly #timers = new Set<ReturnType<typeof setTimeout>>();
  readonly #taskSyncs = new Map<string, Promise<unknown>>();
  readonly #background = new Set<Promise<unknown>>();
  readonly #stopping = new AbortController();
  #watcher: ReturnType<typeof setInterval> | null = null;
  #syncing: Promise<void> | null = null;

  constructor(
    engine: Engine,
    config: ServerConfig,
    runs: RunSupervisor,
    briefings: Briefings,
    options: EffectRunnerOptions
  ) {
    this.#engine = engine;
    this.#config = config;
    this.#runs = runs;
    this.#briefings = briefings;
    this.#triageTask = options.triage;
    this.#wordWatch = options.wordWatch ?? (() => Promise.resolve({ name: null, text: null }));
    this.#describeShare = options.describeShare ?? (() => Promise.resolve(null));
    this.#timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    this.#findRepository = options.findRepository ?? (() => Promise.resolve(null));
    this.#resolveLogin = options.resolveLogin ?? createLoginResolver(config.userHome);
    this.#roots = options.roots ?? { listRoots: () => Promise.resolve(config.roots) };
    this.#watchIntervalMs = options.watchIntervalMs ?? WATCH_INTERVAL_MS;
    this.#services = options.services ?? null;
    this.#shares = options.shares;
    this.#previews = options.previews;
    this.#slack = options.slack ?? null;
    this.#trackProcess = options.trackProcess ?? null;
    this.#feedback = new FeedbackEffects(
      engine,
      config.dataDir,
      options.draftFeedback ?? (() => Promise.resolve(null)),
      (state, entry) =>
        listFeedbackEnvironment(
          state,
          entry,
          options.instance ?? createServerInstance(),
          resolveFeedbackMachine(Boolean(BUNDLE))
        )
    );
    this.#evidence = new EvidenceStore(config.evidenceDir);
    this.#descriptions = new PullRequestDescriptions(this.#evidence);
    this.#bases = new BaseCheckouts(config.checkBasesDir);
    this.#workspaces = options.workspaces ?? new Workspaces({ worktreesDir: config.worktreesDir });
  }

  apply(effect: ShinsaEffect, context: EffectContext): Promise<void> {
    switch (effect.kind) {
      case 'task.triage':
        return this.#triage(effect.taskId, context);
      case 'worktree.create':
        return this.#createWorktree(effect.taskId, context);
      case 'config.verify':
        return this.#verifySetup(effect.taskId, context);
      case 'run.execute':
        return this.#runs.execute(effect.runId);
      case 'run.cancel':
        return this.#runs.cancel(effect.runId);
      case 'run.steer':
        return this.#runs.steer(effect.runId, effect.text, context.key, effect.from);
      case 'question.resolve':
        return this.#runs.resolveQuestion(effect.gateId);
      case 'checks.run':
        return this.#runChecks(effect, context);
      case 'pull_request.open':
        return this.#openPullRequest(effect.taskId, context);
      case 'pull_request.push':
        return this.#push(effect.taskId, context);
      case 'pull_request.merge':
        return this.#merge(effect, context);
      case 'pull_request.watch':
        return this.#watch(effect.taskId, context);
      case 'pull_request.close':
        return this.#closePullRequests(effect, context);
      case 'worktree.remove':
        return this.#removeWorktree(effect.taskId, context);
      case 'scratch.remove':
        return this.#removeScratch(effect.taskId);
      case 'briefing.request':
        this.#briefings.schedule();
        return Promise.resolve();
      case 'watch.suggest':
        return this.#suggestWatch(effect, context);
      case 'run.wake':
        return this.#runs.wake(effect.runId, effect.generation);
      case 'delegation.steer':
        return this.#runs.deliver(effect.runId, effect.generation);
      case 'delegation.reply':
        return this.#runs.replyToDelegate(effect.runId, effect.questionId);
      case 'share.link':
        return this.#shares.link(effect.taskId, context);
      case 'share.describe':
        return this.#writeShareDescription(effect.taskId, context);
      case 'preview.link':
        return this.#previews.link(effect.taskId, effect.serviceId, context);
      case 'slack.evaluate':
        return this.#withSlack((slack) => slack.evaluate(effect, context));
      case 'slack.status':
        return this.#withSlack((slack) => slack.status(effect, context));
      case 'slack.post':
        return this.#withSlack((slack) => slack.post(effect));
      case 'feedback.draft':
        return this.#feedback.draft(effect.feedbackId, context);
      case 'feedback.file':
        return this.#feedback.file(effect.feedbackId, context);
    }
  }

  #withSlack(run: (slack: Slack) => Promise<void>) {
    if (!this.#slack) return Promise.reject(new Error('Slack is not connected on this machine.'));
    return run(this.#slack);
  }

  async #suggestWatch(effect: SuggestEffect, context: EffectContext) {
    const wording = await this.#wordWatch(effect.server, effect.data);
    await this.#engine.dispatch(
      {
        type: 'watch_suggestion.record',
        projectId: effect.projectId,
        server: effect.server,
        name: wording.name,
        text: wording.text,
        timeZone: this.#timeZone,
      },
      { id: `${context.key}:watch_suggestion.record` }
    );
  }

  async #writeShareDescription(taskId: string, context: EffectContext) {
    const task = this.#engine.state.tasks[taskId];
    if (!task?.share) return;
    const description = await this.#describeShare(task);
    if (!description) return;
    await this.#engine.dispatch(
      { type: 'share.describe', taskId, description },
      { id: `${context.key}:share.describe` }
    );
  }

  async #watch(taskId: string, context: EffectContext) {
    await this.syncPullRequest(taskId, true, context.signal);
  }

  startWatching() {
    this.#watcher ??= setInterval(() => {
      this.syncAll().catch((error: unknown) => {
        log.warn('[Watch] Pull request sync failed', { error: describeError(error) });
      });
    }, this.#watchIntervalMs);
  }

  async stop() {
    if (this.#watcher) clearInterval(this.#watcher);
    this.#watcher = null;
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
    this.#stopping.abort();
    await Promise.allSettled([this.#syncing, ...this.#background]);
  }

  async reportRetry(effect: ShinsaEffect, retry: EffectRetry, key: string) {
    if (effect.kind !== 'pull_request.open' && effect.kind !== 'pull_request.push') return;
    const failure = resolveShippingError('pushing', retry.error, this.#config.pushRetryMs);
    await this.#engine.dispatch(
      {
        type: 'pull_request.record_retry',
        taskId: effect.taskId,
        step: failure.step,
        attempt: retry.attempt,
        attempts: retry.attempts,
        retryAt: retry.retryAt,
        detail: failure.detail,
      },
      { id: `${key}:${retry.attempt}:pull_request.record_retry` }
    );
  }

  async reportExhausted(effect: ShinsaEffect, error: string, key: string) {
    if (effect.kind === 'feedback.draft' || effect.kind === 'feedback.file') {
      await this.#feedback.reportExhausted(effect.feedbackId, error, key);
      return;
    }
    if (effect.kind === 'share.link') {
      await this.#engine.dispatch(
        { type: 'share.fail', taskId: effect.taskId, detail: error },
        { id: `${key}:share.fail` }
      );
      return;
    }
    if (effect.kind === 'preview.link') {
      await this.#engine.dispatch(
        { type: 'preview.fail', taskId: effect.taskId, serviceId: effect.serviceId, detail: error },
        { id: `${key}:preview.fail` }
      );
      return;
    }
    const title = FAILURE_TITLE[effect.kind];
    if (!title || !('taskId' in effect) || effect.taskId === null) return;
    await this.#engine.dispatch(
      { type: 'effect.fail', taskId: effect.taskId, title, detail: error },
      { id: `${key}:effect.fail` }
    );
  }

  async recover() {
    await this.#feedback.recover();
    await this.syncAll();
  }

  syncAll() {
    this.#syncing ??= this.#syncWatched().finally(() => {
      this.#syncing = null;
    });
    return this.#syncing;
  }

  async #syncWatched() {
    const watched = Object.values(this.#engine.state.tasks).filter(
      (task) =>
        (task.stage === 'shipping' || task.stage === 'awaiting_merge') && !task.pullRequestWatch?.stopped
    );
    for (const task of watched) await this.syncPullRequest(task.id);
    const failure = await this.#feedback.syncIssues(this.#stopping.signal);
    if (failure) log.warn('[Feedback] Could not read the state of opened issues', { error: failure });
  }

  syncPullRequest(taskId: string, force = false, signal = this.#stopping.signal) {
    const previous = this.#taskSyncs.get(taskId) ?? Promise.resolve();
    const sync = previous.then(() => this.#syncTask(taskId, force, signal));
    const settled = sync.then(
      () => undefined,
      () => undefined
    );
    this.#taskSyncs.set(taskId, settled);
    settled.then(() => {
      if (this.#taskSyncs.get(taskId) === settled) this.#taskSyncs.delete(taskId);
    });
    return sync;
  }

  async #syncTask(taskId: string, force: boolean, signal: AbortSignal) {
    const task = this.#engine.state.tasks[taskId];
    const known = task?.repoId ? this.#engine.state.repos[task.repoId] : undefined;
    if (!task || !known || signal.aborted) return null;
    const repo = await syncRepoRemote(this.#engine, known);
    let read: PullRequestRead | null;
    try {
      const wanted = resolveRoundBase(task) ?? repo.defaultBranch;
      if (task.pullRequest?.state === 'open' && task.pullRequest.base && task.pullRequest.base !== wanted) {
        await retargetPullRequest(repo, task.pullRequest.number, wanted, signal);
      }
      read = await readPullRequest(repo, task, signal);
    } catch (error) {
      if (!signal.aborted) await this.#recordReadFailure(taskId, describeError(error));
      return null;
    }
    if (!read || signal.aborted) return null;
    await this.#checkBundle(repo, task, read.pullRequest, signal);
    const ci = await this.#resolveCi(repo, read.pullRequest, signal);
    if (force || hasPullRequestNews(task, read, ci)) {
      await this.#syncConflictBase(repo, taskId, read.pullRequest, signal);
      await this.#recordRead(taskId, read, ci);
    }
    return read.pullRequest;
  }

  #listBundleBranches(repo: Repo, root: Task): BundleBranch[] {
    const state = this.#engine.state;
    const above = listBundleAbove(state, root);
    if (listBundleBelow(state, root).length > 0 || above.length === 0 || !root.branch) return [];
    if (!above.every((member) => member.bundleReady && member.branch)) return [];
    return [
      { taskId: root.id, branch: root.branch, base: repo.defaultBranch },
      ...above.map((member) => ({
        taskId: member.id,
        branch: member.branch ?? '',
        base: resolveRoundBase(member) ?? repo.defaultBranch,
      })),
    ];
  }

  async #checkBundle(repo: Repo, task: Task, pullRequest: PullRequest, signal: AbortSignal) {
    const branches = this.#listBundleBranches(repo, task);
    if (pullRequest.state !== 'open' || branches.length === 0) return;
    let conflict: BundleConflict | null;
    try {
      conflict = await checkBundleMerge(repo, branches, signal);
    } catch (error) {
      log.warn('[Watch] Could not check that the bundle merges into the default branch', {
        taskId: task.id,
        error: describeError(error),
      });
      return;
    }
    if (!signal.aborted)
      await this.#engine.dispatch({ type: 'bundle.record_check', taskId: task.id, conflict });
  }

  async #syncConflictBase(repo: Repo, taskId: string, pullRequest: PullRequest, signal: AbortSignal) {
    if (pullRequest.mergeable !== false || !pullRequest.base) return;
    let error: string;
    try {
      const result = await syncRemoteBranch(repo, pullRequest.base, signal);
      if (result.ok || signal.aborted) return;
      error = result.stderr;
    } catch (thrown) {
      error = describeError(thrown);
    }
    log.warn('[Watch] Could not fetch the base of a conflicting pull request; the agent fetches it', {
      taskId,
      base: pullRequest.base,
      error,
    });
  }

  #resolveCi(repo: Repo, pullRequest: PullRequest, signal?: AbortSignal): Promise<RepoCi> {
    if (pullRequest.state !== 'open' || pullRequest.checks !== 'none') return Promise.resolve('unknown');
    return this.#ci.resolve(repo, pullRequest.base ?? repo.defaultBranch, signal);
  }

  async #recordRead(taskId: string, read: PullRequestRead, ci: RepoCi) {
    await this.#engine.dispatch({
      type: 'pull_request.record',
      taskId,
      pullRequest: read.pullRequest,
      remarks: read.remarks,
      viewer: read.viewer,
      ci,
    });
  }

  async #recordFreshRead(repo: Repo, taskId: string, read: PullRequestRead, signal: AbortSignal) {
    await this.#recordRead(taskId, read, await this.#resolveCi(repo, read.pullRequest, signal));
  }

  async #recordReadFailure(taskId: string, detail: string) {
    if (RATE_LIMITED.test(detail)) {
      log.warn('[Watch] GitHub is rate limiting reads; this one does not count as a failure', {
        taskId,
        error: detail,
      });
      return;
    }
    log.warn('[Watch] Could not read a pull request', { taskId, error: detail });
    await this.#engine.dispatch({ type: 'pull_request.read_failed', taskId, detail });
  }

  #syncSoon(taskId: string) {
    const timer = setTimeout(() => {
      this.#timers.delete(timer);
      const sync = this.syncPullRequest(taskId, true).catch((error: unknown) => {
        log.warn('[Watch] Pull request sync failed', { taskId, error: describeError(error) });
      });
      this.#background.add(sync);
      sync.then(() => this.#background.delete(sync));
    }, this.#config.settleDelayMs);
    timer.unref();
    this.#timers.add(timer);
  }

  #requireTask(taskId: string) {
    const task = this.#engine.state.tasks[taskId];
    const repo = task?.repoId ? this.#engine.state.repos[task.repoId] : undefined;
    if (!task || !repo) throw new Error('The task or its repository no longer exists.');
    return { task, repo };
  }

  async #triage(taskId: string, context: EffectContext) {
    const task = this.#engine.state.tasks[taskId];
    if (!task || isTaskSettled(task) || task.size !== null) return;
    const triage = await this.#triageTask(this.#engine.state, task, await this.#listCandidates(task));
    if (!triage) throw new Error(NO_TRIAGE);
    const repo = await this.#registerRepo(task, triage.repoPath, context);
    await this.#engine.dispatch(
      {
        type: 'task.triage',
        taskId,
        title: triage.title,
        repoId: repo?.id ?? null,
        size: triage.size,
        branch: triage.branch,
        waitsOn: triage.waitsOn.map((dependency) => dependency.id),
        duplicateOf: triage.duplicateOf,
        shape: triage.shape,
        priority: triage.priority,
        reasons: triage.reasons,
      },
      { id: `${context.key}:task.triage` }
    );
  }

  async #listCandidates(task: Task) {
    return listCandidateRepos(await this.#roots.listRoots(), task.origin);
  }

  #registerRepo(task: Task, path: string | null, context: EffectContext) {
    if (!path) return Promise.resolve(null);
    const projectId = resolveRepoProject(this.#engine.state, task, path);
    return upsertRepo(this.#engine, path, this.#resolveLogin, projectId, {
      id: `${context.key}:repo.register`,
    });
  }

  async #verifySetup(taskId: string, context: EffectContext) {
    const unbound = this.#engine.state.tasks[taskId];
    if (unbound && unbound.repoId === null) {
      await this.#verifyUnbound(unbound, context);
      return;
    }
    const { task, repo } = this.#requireTask(taskId);
    if (task.stage !== 'triage') return;
    await this.#recordSetup(task, repo, context, false);
  }

  async #verifyUnbound(task: Task, context: EffectContext) {
    if (task.stage !== 'triage') return;
    const repo = await this.#registerRepo(task, await this.#findRepoPath(task), context);
    if (context.signal.aborted) return;
    if (!repo) {
      await this.#engine.dispatch(
        { type: 'config.record', taskId: task.id, problems: [] },
        { id: `${context.key}:config.record` }
      );
      return;
    }
    await this.#recordSetup(task, repo, context, true);
  }

  async #findRepoPath(task: Task) {
    if (!needsRepository(resolveTaskPipeline(task))) return null;
    return this.#findRepository(this.#engine.state, task, await this.#listCandidates(task));
  }

  async #recordSetup(task: Task, repo: Repo, context: EffectContext, bind: boolean) {
    const pipeline = resolveTaskPipeline(task);
    const problems = await verifySetup(repo, { defaultBranch: needsWorktree(pipeline) }, context.signal);
    if (needsWorktree(pipeline) && problems.every((problem) => problem.kind !== 'repository')) {
      const mode = resolveTaskWorkspace(this.#engine.state, task);
      const workspace = await describeWorkspaceProblem(
        repo,
        mode,
        task.worktreePath !== null,
        context.signal
      );
      if (workspace) problems.push(workspace);
    }
    if (context.signal.aborted) return;
    await this.#engine.dispatch(
      { type: 'config.record', taskId: task.id, problems, ...(bind ? { repoId: repo.id } : {}) },
      { id: `${context.key}:config.record` }
    );
  }

  async #createWorktree(taskId: string, context: EffectContext) {
    const { task, repo } = this.#requireTask(taskId);
    if (task.stage !== 'triage' || !task.branch) return;
    const worktree = await this.#workspaces.resolve(task).prepare(repo, task, context.signal);
    if (context.signal.aborted) return;
    await this.#engine.dispatch(
      {
        type: 'worktree.ready',
        taskId,
        path: worktree.path,
        branch: worktree.branch,
        ...(worktree.returnBranch === undefined ? {} : { returnBranch: worktree.returnBranch }),
      },
      { id: `${context.key}:worktree.ready` }
    );
  }

  async #runChecks(effect: ChecksEffect, context: EffectContext) {
    const { task, repo } = this.#requireTask(effect.taskId);
    if (task.stage !== 'checking' || !task.worktreePath) return;
    await this.#runs.quiesce(task.id);
    if (task.approvedEdits === 'review') await this.#commitEdits(task, repo, context);
    const worktree = task.worktreePath;
    const env = resolveSharedCacheEnv(worktree, this.#config.dataDir, repo.id);
    const releases: (() => void)[] = [];
    const track = this.#trackProcess;
    const runs = await runChecks(effect.checks, worktree, {
      timeoutMs: CHECK_TIMEOUT_MS,
      signal: context.signal,
      env,
      compare: this.#createBaseComparison(task, repo, worktree, env, context.signal),
      ...(track ? { onSpawn: (pid: number) => releases.push(track(task.id, 'checks', pid)) } : {}),
    }).finally(() => {
      for (const release of releases) release();
    });
    let coverage: Coverage | null = null;
    if (effect.coverage && !runs.some((run) => isBlockingCheck(run.check))) {
      coverage = await measureTaskCoverage({
        repo,
        task,
        commands: listTaskChecks(task, repo).map((check) => check.command),
        baseBranch: resolveRoundBase(task),
        signal: context.signal,
      });
    }
    if (context.signal.aborted) return;
    if (coverage?.status === 'unavailable') {
      log.warn('[Coverage] Could not measure the changed lines', {
        taskId: task.id,
        reason: coverage.reason,
      });
    }
    await this.#engine.dispatch(
      {
        type: 'checks.record',
        taskId: task.id,
        results: runs.map((run) => run.check),
        outputs: this.#storeCheckOutputs(task, runs),
        ...(coverage ? { coverage } : {}),
      },
      { id: `${context.key}:checks.record` }
    );
  }

  #createBaseComparison(
    task: Task,
    repo: Repo,
    cwd: string,
    env: Record<string, string>,
    signal: AbortSignal
  ): BaseComparison {
    let base: Promise<string | null> | null = null;
    const resolveBase = () => {
      base ??= resolveTaskRefs(repo, task, resolveRoundBase(task), signal).then((refs) => refs.base);
      return base;
    };
    return (run) =>
      this.#bases.compareWithBase({
        repo,
        resolveBase,
        cwd,
        run,
        timeoutMs: CHECK_TIMEOUT_MS,
        signal,
        env,
      });
  }

  #storeCheckOutputs(task: Task, runs: readonly CheckRun[]): CheckEvidence[] {
    const folder = { taskId: task.id, round: resolveCurrentRound(task).number };
    return runs.map((run) => ({
      checkId: run.check.id,
      title: run.check.label,
      uri: this.#evidence.writeText(serializeCheckOutput(run), folder, run.check.label),
    }));
  }

  async #recordStep(taskId: string, step: ShippingStep, context: EffectContext) {
    await this.#engine.dispatch(
      { type: 'pull_request.record_step', taskId, step },
      { id: `${context.key}:${context.attempt}:pull_request.record_step:${step.kind}` }
    );
  }

  async #ship<T>(step: ShippingStepKind, work: () => Promise<T>) {
    try {
      return await work();
    } catch (error) {
      throw resolveShippingError(step, error, this.#config.pushRetryMs);
    }
  }

  async #updateOntoBase(task: Task, repo: Repo, context: EffectContext) {
    const base = resolveRoundBase(task) ?? repo.defaultBranch;
    const update = await this.#ship('updating', () =>
      this.#workspaces.resolve(task).syncBase(repo, task, base, {
        signal: context.signal,
        onBehind: () => this.#recordStep(task.id, { kind: 'updating', base }, context),
      })
    );
    if (update.status !== 'conflicted') return true;
    await this.#engine.dispatch(
      { type: 'pull_request.record_update_conflict', taskId: task.id, base, files: update.files },
      { id: `${context.key}:${context.attempt}:pull_request.record_update_conflict` }
    );
    return false;
  }

  async #recordHookFailure(task: Task, error: PushError, context: EffectContext) {
    const output = resolveOutputTail(error.output);
    const failures = listCheckFailures(output, task.worktreePath ?? '');
    await this.#engine.dispatch(
      {
        type: 'pull_request.record_hook_failure',
        taskId: task.id,
        output,
        failures: failures ? failures.map((failure) => failure.label) : null,
      },
      { id: `${context.key}:${context.attempt}:pull_request.record_hook_failure` }
    );
  }

  async #pushBranch(task: Task, repo: Repo, context: EffectContext) {
    const hook = await hasPrePushHook(task.worktreePath ?? repo.path, context.signal);
    await this.#recordStep(task.id, { kind: 'pushing', hook }, context);
    try {
      return await this.#workspaces.resolve(task).push(repo, task, context.signal);
    } catch (error) {
      if (!(error instanceof PushError) || error.kind !== 'hook') throw error;
      await this.#recordHookFailure(task, error, context);
      return null;
    }
  }

  async #pushHead(task: Task, repo: Repo, context: EffectContext) {
    const taskId = task.id;
    await this.#runs.quiesce(taskId);
    if (context.signal.aborted) return false;
    await this.#commitEdits(task, repo, context);
    if (!(await this.#updateOntoBase(task, repo, context)) || context.signal.aborted) return false;
    const sha = await this.#ship('pushing', () => this.#pushBranch(task, repo, context));
    if (sha === null) return false;
    await this.#engine.dispatch(
      { type: 'pull_request.record_push', taskId, sha },
      { id: `${context.key}:pull_request.record_push:${sha}` }
    );
    return true;
  }

  async #commitEdits(task: Task, repo: Repo, context: EffectContext) {
    if ((task.editedPaths ?? []).length === 0) return;
    const commit = await this.#workspaces
      .resolve(task)
      .commit(repo, task, 'fix: apply the edits made in the Code tab');
    await this.#engine.dispatch(
      { type: 'task.commit_edits', taskId: task.id, treeHash: commit.treeHash },
      { id: `${context.key}:task.commit_edits:${commit.treeHash ?? 'none'}` }
    );
  }

  #requireCheckout(taskId: string) {
    const { task, repo } = this.#requireTask(taskId);
    if (!task.worktreePath || !task.branch) throw new Error('The task has no worktree.');
    return { task, repo };
  }

  async #openPullRequest(taskId: string, context: EffectContext) {
    const { task, repo } = await this.#ship('pushing', async () => this.#requireCheckout(taskId));
    const pushed = await this.#pushHead(task, repo, context);
    if (!pushed || context.signal.aborted) return;
    await this.#recordStep(taskId, { kind: 'opening' }, context);
    const read = await this.#ship('opening', async () => {
      const body = await this.#describePullRequest(taskId, context);
      const created = await createPullRequest(repo, task, resolveRoundBase(task), body, context.signal);
      if (!created) throw new Error('GitHub did not return the new pull request.');
      return created;
    });
    await this.#refreshDescription(taskId, context, read.pullRequest);
    await this.#recordFreshRead(repo, taskId, read, context.signal);
    this.#syncSoon(taskId);
  }

  async #push(taskId: string, context: EffectContext) {
    const { task, repo } = await this.#ship('pushing', async () => this.#requireCheckout(taskId));
    if (!task.pullRequest) {
      await this.#openPullRequest(taskId, context);
      return;
    }
    if (!(await this.#pushHead(task, repo, context))) return;
    await this.#refreshDescription(taskId, context);
    this.#syncSoon(taskId);
  }

  async #describePullRequest(taskId: string, context: EffectContext, pullRequest?: PullRequest) {
    const { task: current, repo } = this.#requireTask(taskId);
    const task = pullRequest ? { ...current, pullRequest } : current;
    const evidence = Object.values(this.#engine.state.evidence).filter((piece) => piece.taskId === taskId);
    const { body, uploads } = await this.#descriptions.describe(repo, task, evidence, context.signal);
    if (uploads.length === 0) return body;
    const ids = uploads.map((upload) => upload.evidenceId).join(',');
    await this.#engine.dispatch(
      { type: 'evidence.record_uploads', taskId, uploads },
      { id: `${context.key}:${context.attempt}:evidence.record_uploads:${ids}` }
    );
    return body;
  }

  async #refreshDescription(taskId: string, context: EffectContext, opened?: PullRequest) {
    const number = (opened ?? this.#engine.state.tasks[taskId]?.pullRequest)?.number;
    if (number === undefined || context.signal.aborted) return;
    try {
      const body = await this.#describePullRequest(taskId, context, opened);
      const { repo } = this.#requireTask(taskId);
      await writePullRequestBlock(repo, number, body, context.signal);
    } catch (error) {
      log.warn('[GitHub] Could not refresh the pull request description', {
        taskId,
        number,
        error: describeError(error),
      });
    }
  }

  async #mergeHead(repo: Repo, task: Task, number: number, headSha: string | null, signal: AbortSignal) {
    try {
      await mergePullRequest(repo, number, this.#engine.state.settings.mergeMethod, headSha, signal);
      return true;
    } catch (error) {
      const read = await readPullRequest(repo, task, signal);
      if (!read || !isHeadMoved(headSha, read.pullRequest)) throw error;
      await this.#recordFreshRead(repo, task.id, read, signal);
      return false;
    }
  }

  async #mergeStack(repo: Repo, stacked: RoundPullRequest[], signal: AbortSignal) {
    for (const pull of stacked) {
      signal.throwIfAborted();
      const read = await readStackedPullRequest(repo, pull.number, signal);
      if (needsMerge(read?.pullRequest)) {
        await mergePullRequest(repo, pull.number, this.#engine.state.settings.mergeMethod, null, signal);
      }
    }
  }

  async #assertStackMerged(repo: Repo, stacked: RoundPullRequest[], signal: AbortSignal) {
    for (const pull of stacked) {
      const read = await readStackedPullRequest(repo, pull.number, signal);
      if (read && isAwaitingMerge(read.pullRequest)) {
        throw new Error(
          `GitHub still shows pull request #${pull.number} below this one as open after merging it. Retry to check it again and merge it.`
        );
      }
    }
  }

  async #merge(effect: MergeEffect, context: EffectContext) {
    const bundle = effect.bundle ?? [];
    if (bundle.length === 0) {
      await this.#mergeTask(effect.taskId, effect.headSha, context.signal);
      return;
    }
    if ((await this.#isRootMoved(effect.taskId, effect.headSha, context.signal)) || context.signal.aborted)
      return;
    await this.#assertBundleMerges(effect.taskId, context.signal);
    for (const member of bundle) {
      if (!(await this.#mergeTask(member.taskId, null, context.signal))) return;
    }
    await this.#mergeTask(effect.taskId, null, context.signal);
  }

  async #isRootMoved(taskId: string, headSha: string | null, signal: AbortSignal) {
    const { task, repo } = this.#requireTask(taskId);
    const current = await readPullRequest(repo, task, signal);
    const moved = Boolean(
      current && needsMerge(current.pullRequest) && isHeadMoved(headSha, current.pullRequest)
    );
    if (moved && current) await this.#recordFreshRead(repo, taskId, current, signal);
    return moved;
  }

  async #assertBundleMerges(taskId: string, signal: AbortSignal) {
    const { task, repo } = this.#requireTask(taskId);
    const conflict = await checkBundleMerge(repo, this.#listBundleBranches(repo, task), signal);
    if (!conflict) return;
    const title = this.#engine.state.tasks[conflict.taskId]?.title ?? 'A task';
    throw new Error(
      `“${title}” conflicts with ${repo.defaultBranch} once the bundle merges, so nothing was merged. Retry to bring the bundle up to date first.`
    );
  }

  async #mergeTask(taskId: string, headSha: string | null, signal: AbortSignal) {
    const { task, repo } = this.#requireTask(taskId);
    if (!task.pullRequest) throw new Error('There is no pull request to merge.');
    if (signal.aborted) return false;
    const current = await readPullRequest(repo, task, signal);
    if (signal.aborted) return false;
    if (current && needsMerge(current.pullRequest) && isHeadMoved(headSha, current.pullRequest)) {
      await this.#recordFreshRead(repo, taskId, current, signal);
      return false;
    }
    if (needsMerge(current?.pullRequest)) {
      const merged = await this.#mergeHead(repo, task, task.pullRequest.number, headSha, signal);
      if (!merged) return false;
    }
    const stacked = listStackedPullRequests(task);
    await this.#mergeStack(repo, stacked, signal);
    const after = await readPullRequest(repo, task, signal);
    if (after) await this.#recordFreshRead(repo, taskId, after, signal);
    if (after && isAwaitingMerge(after.pullRequest)) throw new Error(NOT_MERGED_YET);
    await this.#assertStackMerged(repo, stacked, signal);
    return true;
  }

  async #closePullRequests(effect: CloseEffect, context: EffectContext) {
    const { repo } = this.#requireTask(effect.taskId);
    const closed: number[] = [];
    const failed: PullRequestCloseFailure[] = [];
    for (const number of effect.numbers) {
      if (context.signal.aborted) return;
      try {
        await closePullRequest(repo, number, CANCELLED_COMMENT, context.signal);
        closed.push(number);
      } catch (error) {
        log.warn('[Effects] Could not close a pull request', {
          taskId: effect.taskId,
          number,
          error: describeError(error),
        });
        failed.push({ number, detail: describeError(error) });
      }
    }
    await this.#engine.dispatch(
      { type: 'pull_request.record_closed', taskId: effect.taskId, closed, failed },
      { id: `${context.key}:pull_request.record_closed` }
    );
  }

  async #removeIsolated(repo: Repo, taskId: string) {
    try {
      await removeIsolatedWorktrees(repo, this.#config.worktreesDir, taskId);
    } catch (error) {
      log.warn('[Effects] Could not remove the checkouts of delegations', {
        taskId,
        error: describeError(error),
      });
    }
  }

  async #removeWorktree(taskId: string, context: EffectContext) {
    const task = this.#engine.state.tasks[taskId];
    const repo = task?.repoId ? this.#engine.state.repos[task.repoId] : undefined;
    if (repo) await this.#removeIsolated(repo, taskId);
    if (!task?.worktreePath || !repo) return;
    this.#services?.closeTaskServices(taskId);
    try {
      const workspace = this.#workspaces.resolve(task);
      if (workspace.mode === 'worktrees')
        await stopProcessesIn(task.worktreePath, { spare: this.#services?.listTerminalPids() ?? [] });
      await workspace.remove(repo, task);
    } catch (error) {
      log.warn('[Effects] Could not remove a worktree', { taskId, error: describeError(error) });
    }
    try {
      pruneSharedCaches(this.#config.dataDir, Object.keys(this.#engine.state.repos), Date.now());
    } catch (error) {
      log.warn('[Effects] Could not prune the shared build caches', { error: describeError(error) });
    }
    await this.#engine.dispatch({ type: 'worktree.gone', taskId }, { id: `${context.key}:worktree.gone` });
  }

  #isReopened(taskId: string) {
    const task = this.#engine.state.tasks[taskId];
    return task !== undefined && !isTaskSettled(task);
  }

  async #removeScratch(taskId: string) {
    if (this.#isReopened(taskId)) return;
    await this.#runs.quiesce(taskId);
    if (this.#isReopened(taskId)) return;
    rmSync(resolveScratchPath(this.#config.dataDir, taskId), { recursive: true, force: true });
  }
}
