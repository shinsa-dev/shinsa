import { rmSync } from 'node:fs';
import {
  type Coverage,
  evaluatePullRequestWatch,
  isOfCurrentRound,
  isSamePullRequest,
  isSamePullRequestWatch,
  isTaskSettled,
  listStackedPullRequests,
  needsRepository,
  needsWorktree,
  type PullRequest,
  type Repo,
  type RoundPullRequest,
  resolveCurrentRound,
  resolvePullRequestBase,
  resolveTaskPipeline,
  resolveTaskWorkspace,
  type ShinsaEffect,
  type Task,
} from '@shinsa/core';
import type { RunSupervisor } from '../agents/supervisor.ts';
import type { Briefings } from '../briefing/index.ts';
import { serializeCheckEvidence } from '../checks/evidence.ts';
import { type CheckRun, runChecks } from '../checks/index.ts';
import { resolveScratchPath, type ServerConfig } from '../config/index.ts';
import { removeIsolatedWorktrees, syncRemoteBranch } from '../git/index.ts';
import {
  createPullRequest,
  mergePullRequest,
  type PullRequestRead,
  readPullRequest,
  readStackedPullRequest,
  retargetPullRequest,
} from '../github/index.ts';
import { describeError, log } from '../log/index.ts';
import {
  createLoginResolver,
  type LoginResolver,
  listCandidateRepos,
  type RootSource,
  upsertRepo,
  verifySetup,
} from '../repos/index.ts';
import { EvidenceStore } from '../store/evidence.ts';
import { measureTaskCoverage } from '../test-coverage/index.ts';
import { resolveRepoProject, type TriageResolver } from '../triage/index.ts';
import type { RepositoryFinder } from '../triage/message.ts';
import { ConflictedBranchError, describeWorkspaceProblem, Workspaces } from '../workspaces/index.ts';
import { LedgerStore } from '../workspaces/ledger.ts';
import type { EffectContext, Engine } from './engine.ts';

export interface EffectRunnerOptions {
  triage: TriageResolver;
  findRepository?: RepositoryFinder;
  resolveLogin?: LoginResolver;
  roots?: RootSource;
  watchIntervalMs?: number;
  workspaces?: Workspaces;
  services?: TaskServices;
}

export interface TaskServices {
  closeTaskServices(taskId: string): void;
}

const WATCH_INTERVAL_MS = 45_000;

const OUTPUT_KINDS = new Set(['test', 'check', 'note']);

const FAILURE_TITLE: Partial<Record<ShinsaEffect['kind'], string>> = {
  'task.triage': 'Could not start the task',
  'config.verify': 'Could not verify the setup',
  'worktree.create': 'Could not set up the worktree',
  'checks.run': 'Could not run the checks',
  'pull_request.open': 'Could not open the pull request',
  'pull_request.push': 'Could not push the fixes',
  'pull_request.merge': 'Could not merge the pull request',
  'workspace.update': 'Could not update the workspace',
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

function hasPullRequestNews(task: Task, read: PullRequestRead) {
  if ((task.pullRequestReadFailures ?? 0) > 0) return true;
  if (!isSamePullRequest(task.pullRequest, read.pullRequest)) return true;
  const watch = task.pullRequestWatch;
  if (!watch) return true;
  const report = evaluatePullRequestWatch(watch, read.pullRequest, read.remarks, read.viewer);
  return report.changes.length > 0 || !isSamePullRequestWatch(report.next, watch);
}

export class EffectRunner {
  readonly #engine: Engine;
  readonly #config: ServerConfig;
  readonly #runs: RunSupervisor;
  readonly #briefings: Briefings;
  readonly #triageTask: TriageResolver;
  readonly #findRepository: RepositoryFinder;
  readonly #resolveLogin: LoginResolver;
  readonly #roots: RootSource;
  readonly #watchIntervalMs: number;
  readonly #workspaces: Workspaces;
  readonly #services: TaskServices | null;
  readonly #evidence: EvidenceStore;
  readonly #ledgers: LedgerStore;
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
    this.#findRepository = options.findRepository ?? (() => Promise.resolve(null));
    this.#resolveLogin = options.resolveLogin ?? createLoginResolver(config.userHome);
    this.#roots = options.roots ?? { listRoots: () => Promise.resolve(config.roots) };
    this.#watchIntervalMs = options.watchIntervalMs ?? WATCH_INTERVAL_MS;
    this.#services = options.services ?? null;
    this.#evidence = new EvidenceStore(config.evidenceDir);
    this.#ledgers = new LedgerStore(config.dataDir);
    this.#workspaces =
      options.workspaces ?? new Workspaces({ dataDir: config.dataDir, worktreesDir: config.worktreesDir });
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
        return this.#runChecks(effect.taskId, context);
      case 'pull_request.open':
        return this.#openPullRequest(effect.taskId, context);
      case 'pull_request.push':
        return this.#push(effect.taskId, context);
      case 'pull_request.merge':
        return this.#merge(effect.taskId, context);
      case 'pull_request.watch':
        return this.#watch(effect.taskId, context);
      case 'workspace.update':
        return this.#updateWorkspace(effect.taskId, effect.guidance, context);
      case 'worktree.remove':
        return this.#removeWorktree(effect.taskId, context);
      case 'scratch.remove':
        return this.#removeScratch(effect.taskId);
      case 'briefing.request':
        this.#briefings.schedule();
        return Promise.resolve();
      case 'run.wake':
        return this.#runs.wake(effect.runId, effect.generation);
      case 'delegation.steer':
        return this.#runs.deliver(effect.runId, effect.generation);
      case 'delegation.reply':
        return this.#runs.replyToDelegate(effect.runId, effect.questionId);
    }
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

  async reportExhausted(effect: ShinsaEffect, error: string, key: string) {
    const title = FAILURE_TITLE[effect.kind];
    if (!title || !('taskId' in effect)) return;
    await this.#engine.dispatch(
      { type: 'effect.fail', taskId: effect.taskId, title, detail: error },
      { id: `${key}:effect.fail` }
    );
  }

  async recover() {
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
    const repo = task?.repoId ? this.#engine.state.repos[task.repoId] : undefined;
    if (!task || !repo || signal.aborted) return null;
    let read: PullRequestRead | null;
    try {
      const wanted = resolvePullRequestBase(this.#engine.state, task) ?? repo.defaultBranch;
      if (task.pullRequest?.state === 'open' && task.pullRequest.base && task.pullRequest.base !== wanted) {
        await retargetPullRequest(repo, task.pullRequest.number, wanted, signal);
      }
      read = await readPullRequest(repo, task, signal);
    } catch (error) {
      if (!signal.aborted) await this.#recordReadFailure(taskId, describeError(error));
      return null;
    }
    if (!read || signal.aborted) return null;
    if (force || hasPullRequestNews(task, read)) {
      await this.#syncConflictBase(repo, taskId, read.pullRequest, signal);
      await this.#recordRead(taskId, read);
    }
    return read.pullRequest;
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

  async #recordRead(taskId: string, read: PullRequestRead) {
    await this.#engine.dispatch({
      type: 'pull_request.record',
      taskId,
      pullRequest: read.pullRequest,
      remarks: read.remarks,
      viewer: read.viewer,
    });
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
    const problems = await verifySetup(
      repo,
      { defaultBranch: needsWorktree(pipeline), checks: pipeline.includes('build') },
      context.signal
    );
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

  async #runChecks(taskId: string, context: EffectContext) {
    const { task, repo } = this.#requireTask(taskId);
    if (task.stage !== 'checking' || !task.worktreePath) return;
    await this.#runs.quiesce(taskId);
    if (task.approvedEdits === 'review') await this.#commitEdits(task, repo, context);
    const planChecks = task.plan?.document?.checks ?? [];
    const release = await this.#workspaces.resolve(task).claim(repo, task, context.signal);
    let runs: CheckRun[];
    let coverage: Coverage | null = null;
    try {
      runs = await runChecks(repo, task.worktreePath, planChecks, context.signal);
      if (runs.every((run) => run.check.outcome !== 'fail')) {
        coverage = await measureTaskCoverage({
          repo,
          task,
          ledgers: this.#ledgers,
          baseBranch: resolvePullRequestBase(this.#engine.state, task),
          signal: context.signal,
        });
      }
    } finally {
      await release();
    }
    if (context.signal.aborted) return;
    if (coverage?.status === 'unavailable') {
      log.warn('[Coverage] Could not measure the changed lines', { taskId, reason: coverage.reason });
    }
    const evidence = this.#storeCheckEvidence(task, runs);
    await this.#engine.dispatch(
      {
        type: 'checks.record',
        taskId,
        results: runs.map((run) => run.check),
        ...(evidence ? { evidence } : {}),
        ...(coverage ? { coverage } : {}),
      },
      { id: `${context.key}:checks.record` }
    );
  }

  #storeCheckEvidence(task: Task, runs: readonly CheckRun[]) {
    const attached = Object.values(this.#engine.state.evidence).flatMap((item) => {
      if (item.taskId !== task.id || item.runId === null || !OUTPUT_KINDS.has(item.kind)) return [];
      const text = isOfCurrentRound(task, item) ? this.#evidence.selectText(item.uri) : null;
      return text === null ? [] : [text];
    });
    const piece = serializeCheckEvidence(runs, attached);
    if (!piece) return null;
    const folder = { taskId: task.id, round: resolveCurrentRound(task).number };
    return {
      title: piece.title,
      detail: piece.detail,
      uri: this.#evidence.writeText(piece.text, folder, piece.title),
    };
  }

  async #pushHead(task: Task, repo: Repo, context: EffectContext) {
    const taskId = task.id;
    await this.#runs.quiesce(taskId);
    if (context.signal.aborted) return false;
    await this.#commitEdits(task, repo, context);
    let sha: string;
    try {
      sha = await this.#workspaces.resolve(task).push(repo, task, context.signal);
    } catch (error) {
      if (!(error instanceof ConflictedBranchError)) throw error;
      await this.#engine.dispatch(
        { type: 'task.record_conflict', taskId, branch: error.branch },
        { id: `${context.key}:task.record_conflict` }
      );
      return false;
    }
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

  async #updateWorkspace(taskId: string, guidance: string | null, context: EffectContext) {
    const { task, repo } = this.#requireTask(taskId);
    if (task.stage !== 'shipping') return;
    await this.#runs.quiesce(taskId);
    await this.#workspaces.resolve(task).update(repo, context.signal);
    if (context.signal.aborted) return;
    await this.#engine.dispatch(
      { type: 'task.record_workspace_update', taskId, guidance },
      { id: `${context.key}:task.record_workspace_update` }
    );
  }

  async #openPullRequest(taskId: string, context: EffectContext) {
    const { task, repo } = this.#requireTask(taskId);
    if (!task.worktreePath || !task.branch) throw new Error('The task has no worktree.');
    const pushed = await this.#pushHead(task, repo, context);
    if (!pushed || context.signal.aborted) return;
    const read = await createPullRequest(
      repo,
      task,
      resolvePullRequestBase(this.#engine.state, task),
      context.signal
    );
    if (!read) throw new Error('GitHub did not return the new pull request.');
    await this.#recordRead(taskId, read);
    this.#syncSoon(taskId);
  }

  async #push(taskId: string, context: EffectContext) {
    const { task, repo } = this.#requireTask(taskId);
    if (!task.worktreePath || !task.branch) throw new Error('The task has no worktree.');
    if (!task.pullRequest) {
      await this.#openPullRequest(taskId, context);
      return;
    }
    if (await this.#pushHead(task, repo, context)) this.#syncSoon(taskId);
  }

  async #mergeStack(repo: Repo, stacked: RoundPullRequest[], signal: AbortSignal) {
    for (const pull of stacked) {
      signal.throwIfAborted();
      const read = await readStackedPullRequest(repo, pull.number, signal);
      if (needsMerge(read?.pullRequest)) {
        await mergePullRequest(repo, pull.number, this.#engine.state.settings.mergeMethod, signal);
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

  async #merge(taskId: string, context: EffectContext) {
    const { task, repo } = this.#requireTask(taskId);
    if (!task.pullRequest) throw new Error('There is no pull request to merge.');
    if (context.signal.aborted) return;
    const current = (await readPullRequest(repo, task, context.signal))?.pullRequest;
    if (context.signal.aborted) return;
    if (needsMerge(current)) {
      await mergePullRequest(
        repo,
        task.pullRequest.number,
        this.#engine.state.settings.mergeMethod,
        context.signal
      );
    }
    const stacked = listStackedPullRequests(task);
    await this.#mergeStack(repo, stacked, context.signal);
    const after = await readPullRequest(repo, task, context.signal);
    if (after) await this.#recordRead(taskId, after);
    if (after && isAwaitingMerge(after.pullRequest)) throw new Error(NOT_MERGED_YET);
    await this.#assertStackMerged(repo, stacked, context.signal);
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
      await this.#workspaces.resolve(task).remove(repo, task);
    } catch (error) {
      log.warn('[Effects] Could not remove a worktree', { taskId, error: describeError(error) });
    }
    await this.#engine.dispatch({ type: 'worktree.gone', taskId }, { id: `${context.key}:worktree.gone` });
    await this.#recordConflicts(task, repo, context);
  }

  async #recordConflicts(removed: Task, repo: Repo, context: EffectContext) {
    let conflicted: string[];
    try {
      conflicted = await this.#workspaces.resolve(removed).listConflicted(repo);
    } catch (error) {
      log.warn('[Effects] Could not read which branches are conflicted', {
        taskId: removed.id,
        error: describeError(error),
      });
      return;
    }
    for (const task of Object.values(this.#engine.state.tasks)) {
      const branch = task.branch;
      if (task.repoId !== repo.id || isTaskSettled(task) || !branch || !conflicted.includes(branch)) continue;
      await this.#engine.dispatch(
        { type: 'task.record_conflict', taskId: task.id, branch },
        { id: `${context.key}:task.record_conflict:${task.id}` }
      );
    }
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
