import { existsSync } from 'node:fs';
import {
  evaluatePullRequestWatch,
  isLaterRound,
  isSamePullRequest,
  isSamePullRequestWatch,
  isTaskSettled,
  listStackedPullRequests,
  needsWorktree,
  type PullRequest,
  type Repo,
  type RoundPullRequest,
  resolveTaskPipeline,
  resolveTaskProject,
  type ShinsaEffect,
  selectFolderProject,
  type Task,
} from '@shinsa/core';
import type { RunSupervisor } from '../agents/supervisor.ts';
import type { Briefings } from '../briefing/index.ts';
import { runChecks } from '../checks/index.ts';
import type { ServerConfig } from '../config/index.ts';
import {
  createWorktree,
  discardEdits,
  pushBranch,
  refreshWorktree,
  removeIsolatedWorktrees,
  removeWorktree,
  resolveHead,
} from '../git/index.ts';
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
import type { TriageResolver } from '../triage/index.ts';
import { resolveTaskBaseBranch } from './base.ts';
import type { EffectContext, Engine } from './engine.ts';

export interface EffectRunnerOptions {
  triage: TriageResolver;
  resolveLogin?: LoginResolver;
  roots?: RootSource;
  watchIntervalMs?: number;
}

const WATCH_INTERVAL_MS = 45_000;

const FAILURE_TITLE: Partial<Record<ShinsaEffect['kind'], string>> = {
  'task.triage': 'Could not start the task',
  'config.verify': 'Could not check the setup',
  'worktree.create': 'Could not set up the worktree',
  'checks.run': 'Could not run the checks',
  'pull_request.open': 'Could not open the pull request',
  'pull_request.push': 'Could not push the fixes',
  'pull_request.merge': 'Could not merge the pull request',
};

const NO_REPOSITORIES =
  'Shinsa found no git repositories in the folders it searches. Choose the folders that hold them in setup, or set SHINSA_ROOTS.';

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
  readonly #resolveLogin: LoginResolver;
  readonly #roots: RootSource;
  readonly #watchIntervalMs: number;
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
    this.#resolveLogin = options.resolveLogin ?? createLoginResolver(config.userHome);
    this.#roots = options.roots ?? { listRoots: () => Promise.resolve(config.roots) };
    this.#watchIntervalMs = options.watchIntervalMs ?? WATCH_INTERVAL_MS;
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
        return this.#runs.steer(effect.runId, effect.text, context.key);
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
      case 'worktree.remove':
        return this.#removeWorktree(effect.taskId, context);
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
      const wanted = resolveTaskBaseBranch(this.#engine.state, task) ?? repo.defaultBranch;
      if (task.pullRequest?.state === 'open' && task.pullRequest.base && task.pullRequest.base !== wanted) {
        await retargetPullRequest(repo, task.pullRequest.number, wanted, signal);
      }
      read = await readPullRequest(repo, task, signal);
    } catch (error) {
      if (!signal.aborted) await this.#recordReadFailure(taskId, describeError(error));
      return null;
    }
    if (!read || signal.aborted) return null;
    if (force || hasPullRequestNews(task, read)) await this.#recordRead(taskId, read);
    return read.pullRequest;
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
    const candidates = await listCandidateRepos(await this.#roots.listRoots(), task.origin);
    const triage = await this.#triageTask(this.#engine.state, task, candidates);
    if (!triage) throw new Error(NO_REPOSITORIES);
    const repo = await upsertRepo(
      this.#engine,
      triage.repoPath,
      this.#resolveLogin,
      this.#resolveTriageProject(task, triage.repoPath),
      { id: `${context.key}:repo.register` }
    );
    await this.#engine.dispatch(
      {
        type: 'task.triage',
        taskId,
        title: triage.title,
        repoId: repo.id,
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

  #resolveTriageProject(task: Task, path: string) {
    const state = this.#engine.state;
    return selectFolderProject(Object.values(state.projects), path)?.id ?? resolveTaskProject(state, task);
  }

  async #verifySetup(taskId: string, context: EffectContext) {
    const { task, repo } = this.#requireTask(taskId);
    if (task.stage !== 'triage') return;
    const pipeline = resolveTaskPipeline(task);
    const problems = await verifySetup(
      repo,
      { defaultBranch: needsWorktree(pipeline), checks: pipeline.includes('build') },
      context.signal
    );
    if (context.signal.aborted) return;
    await this.#engine.dispatch(
      { type: 'config.record', taskId, problems },
      { id: `${context.key}:config.record` }
    );
  }

  async #createWorktree(taskId: string, context: EffectContext) {
    const { task, repo } = this.#requireTask(taskId);
    if (task.stage !== 'triage' || !task.branch) return;
    if (task.worktreePath && existsSync(task.worktreePath)) {
      if (task.phaseReports.length === 0 && isLaterRound(task))
        await discardEdits(task.worktreePath, context.signal);
      else if (task.phaseReports.length === 0 && !task.pullRequest)
        await refreshWorktree(repo, task.worktreePath, context.signal);
      if (context.signal.aborted) return;
      await this.#engine.dispatch(
        { type: 'worktree.ready', taskId, path: task.worktreePath, branch: task.branch },
        { id: `${context.key}:worktree.ready` }
      );
      return;
    }
    const worktree = await createWorktree(
      repo,
      this.#config.worktreesDir,
      taskId,
      task.branch,
      resolveTaskBaseBranch(this.#engine.state, task),
      context.signal
    );
    if (context.signal.aborted) return;
    await this.#engine.dispatch(
      { type: 'worktree.ready', taskId, path: worktree.path, branch: worktree.branch },
      { id: `${context.key}:worktree.ready` }
    );
  }

  async #runChecks(taskId: string, context: EffectContext) {
    const { task, repo } = this.#requireTask(taskId);
    if (task.stage !== 'checking' || !task.worktreePath) return;
    await this.#runs.quiesce(taskId);
    const planChecks = task.spec?.document?.checks ?? [];
    const results = await runChecks(repo, task.worktreePath, planChecks, context.signal);
    if (context.signal.aborted) return;
    await this.#engine.dispatch(
      { type: 'checks.record', taskId, results },
      { id: `${context.key}:checks.record` }
    );
  }

  async #pushHead(taskId: string, path: string, branch: string, context: EffectContext) {
    await this.#runs.quiesce(taskId);
    if (context.signal.aborted) return false;
    await pushBranch(path, branch, context.signal);
    const sha = await resolveHead(path);
    await this.#engine.dispatch(
      { type: 'pull_request.pushed', taskId, sha },
      { id: `${context.key}:pull_request.pushed:${sha}` }
    );
    return true;
  }

  async #openPullRequest(taskId: string, context: EffectContext) {
    const { task, repo } = this.#requireTask(taskId);
    if (!task.worktreePath || !task.branch) throw new Error('The task has no worktree.');
    const pushed = await this.#pushHead(taskId, task.worktreePath, task.branch, context);
    if (!pushed || context.signal.aborted) return;
    const read = await createPullRequest(
      repo,
      task,
      resolveTaskBaseBranch(this.#engine.state, task),
      context.signal
    );
    if (!read) throw new Error('GitHub did not return the new pull request.');
    await this.#recordRead(taskId, read);
    this.#syncSoon(taskId);
  }

  async #push(taskId: string, context: EffectContext) {
    const { task } = this.#requireTask(taskId);
    if (!task.worktreePath || !task.branch) throw new Error('The task has no worktree.');
    if (!task.pullRequest) {
      await this.#openPullRequest(taskId, context);
      return;
    }
    if (await this.#pushHead(taskId, task.worktreePath, task.branch, context)) this.#syncSoon(taskId);
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
      log.warn('[Effects] Could not remove the checkouts of delegated tasks', {
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
    try {
      await removeWorktree(repo, task.worktreePath);
    } catch (error) {
      log.warn('[Effects] Could not remove a worktree', { taskId, error: describeError(error) });
    }
    await this.#engine.dispatch({ type: 'worktree.gone', taskId }, { id: `${context.key}:worktree.gone` });
  }
}
