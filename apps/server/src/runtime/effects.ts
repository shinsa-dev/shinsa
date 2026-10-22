import { existsSync } from 'node:fs';
import { isTaskSettled, type PullRequest, type ShinsaEffect, type Task } from '@shinsa/core';
import type { RunSupervisor } from '../agents/supervisor.ts';
import type { Briefings } from '../briefing/index.ts';
import { runChecks } from '../checks/index.ts';
import type { ServerConfig } from '../config/index.ts';
import { createWorktree, pushBranch, refreshWorktree, removeWorktree, resolveHead } from '../git/index.ts';
import {
  createPullRequest,
  mergePullRequest,
  retargetPullRequest,
  selectPullRequest,
} from '../github/index.ts';
import { describeError, log } from '../log/index.ts';
import { type LoginResolver, listCandidateRepos, resolveGithubLogin, upsertRepo } from '../repos/index.ts';
import { resolveTriage, type TriageResolver } from '../triage/index.ts';
import type { Engine } from './engine.ts';

export interface EffectRunnerOptions {
  triage?: TriageResolver;
  resolveLogin?: LoginResolver;
  watchIntervalMs?: number;
}

const WATCH_INTERVAL_MS = 45_000;

const FAILURE_TITLE: Partial<Record<ShinsaEffect['kind'], string>> = {
  'task.triage': 'Could not start the task',
  'worktree.create': 'Could not set up the worktree',
  'checks.run': 'Could not run the checks',
  'pull_request.open': 'Could not open the pull request',
  'pull_request.push': 'Could not push the fixes',
  'pull_request.merge': 'Could not merge the pull request',
};

const NO_REPOSITORIES =
  'Shinsa found no git repositories. It looks in ~/Developer, ~/Projects, ~/code and ~/src; set SHINSA_ROOTS to add more.';

export function isSamePullRequest(a: PullRequest | null, b: PullRequest) {
  if (!a) return false;
  return (
    a.number === b.number &&
    a.base === b.base &&
    a.state === b.state &&
    a.checks === b.checks &&
    a.unresolvedComments === b.unresolvedComments &&
    a.mergeable === b.mergeable &&
    a.headSha === b.headSha
  );
}

export class EffectRunner {
  readonly #engine: Engine;
  readonly #config: ServerConfig;
  readonly #runs: RunSupervisor;
  readonly #briefings: Briefings;
  readonly #triageTask: TriageResolver;
  readonly #resolveLogin: LoginResolver;
  readonly #watchIntervalMs: number;
  readonly #timers = new Set<ReturnType<typeof setTimeout>>();
  #watcher: ReturnType<typeof setInterval> | null = null;
  #syncing: Promise<void> | null = null;

  constructor(
    engine: Engine,
    config: ServerConfig,
    runs: RunSupervisor,
    briefings: Briefings,
    options: EffectRunnerOptions = {}
  ) {
    this.#engine = engine;
    this.#config = config;
    this.#runs = runs;
    this.#briefings = briefings;
    this.#triageTask = options.triage ?? resolveTriage;
    this.#resolveLogin = options.resolveLogin ?? resolveGithubLogin;
    this.#watchIntervalMs = options.watchIntervalMs ?? WATCH_INTERVAL_MS;
  }

  apply(effect: ShinsaEffect): Promise<void> {
    switch (effect.kind) {
      case 'task.triage':
        return this.#triage(effect.taskId);
      case 'worktree.create':
        return this.#createWorktree(effect.taskId);
      case 'run.execute':
        return this.#runs.execute(effect.runId);
      case 'run.cancel':
        return this.#runs.cancel(effect.runId);
      case 'run.steer':
        return this.#runs.steer(effect.runId, effect.text);
      case 'question.resolve':
        return this.#runs.resolveQuestion(effect.gateId);
      case 'checks.run':
        return this.#runChecks(effect.taskId);
      case 'pull_request.open':
        return this.#openPullRequest(effect.taskId);
      case 'pull_request.push':
        return this.#push(effect.taskId);
      case 'pull_request.merge':
        return this.#merge(effect.taskId);
      case 'pull_request.watch':
        return this.syncPullRequest(effect.taskId, true);
      case 'worktree.remove':
        return this.#removeWorktree(effect.taskId);
      case 'briefing.request':
        this.#briefings.schedule();
        return Promise.resolve();
    }
  }

  startWatching() {
    this.#watcher ??= setInterval(() => {
      this.syncAll().catch((error: unknown) => {
        log.warn('[Watch] Pull request sync failed', { error: describeError(error) });
      });
    }, this.#watchIntervalMs);
  }

  stop() {
    if (this.#watcher) clearInterval(this.#watcher);
    this.#watcher = null;
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
  }

  async reportExhausted(effect: ShinsaEffect, error: string) {
    const title = FAILURE_TITLE[effect.kind];
    if (!title || !('taskId' in effect)) return;
    await this.#engine.dispatch({ type: 'effect.fail', taskId: effect.taskId, title, detail: error });
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
      (task) => task.stage === 'shipping' || task.stage === 'awaiting_merge'
    );
    for (const task of watched) await this.syncPullRequest(task.id);
  }

  async syncPullRequest(taskId: string, force = false) {
    const task = this.#engine.state.tasks[taskId];
    const repo = task?.repoId ? this.#engine.state.repos[task.repoId] : undefined;
    if (!task || !repo) return;
    const wanted = this.#resolveBaseBranch(task) ?? repo.defaultBranch;
    if (task.pullRequest?.state === 'open' && task.pullRequest.base && task.pullRequest.base !== wanted) {
      await retargetPullRequest(repo, task.pullRequest.number, wanted);
    }
    const pullRequest = await selectPullRequest(repo, task);
    if (!pullRequest) return;
    if (!force && isSamePullRequest(task.pullRequest, pullRequest)) return;
    await this.#engine.dispatch({ type: 'pull_request.record', taskId, pullRequest });
  }

  #syncSoon(taskId: string) {
    const timer = setTimeout(() => {
      this.#timers.delete(timer);
      this.syncPullRequest(taskId, true).catch((error: unknown) => {
        log.warn('[Watch] Pull request sync failed', { taskId, error: describeError(error) });
      });
    }, this.#config.settleDelayMs);
    timer.unref();
    this.#timers.add(timer);
  }

  #resolveBaseBranch(task: Task) {
    const base = task.baseTaskId ? this.#engine.state.tasks[task.baseTaskId] : undefined;
    if (base?.branch && base.stage !== 'merged' && base.stage !== 'cancelled') return base.branch;
    return null;
  }

  #requireTask(taskId: string) {
    const task = this.#engine.state.tasks[taskId];
    const repo = task?.repoId ? this.#engine.state.repos[task.repoId] : undefined;
    if (!task || !repo) throw new Error('The task or its repository no longer exists.');
    return { task, repo };
  }

  async #triage(taskId: string) {
    const task = this.#engine.state.tasks[taskId];
    if (!task || isTaskSettled(task) || task.branch !== null) return;
    const candidates = await listCandidateRepos(this.#config.roots, task.origin);
    const triage = await this.#triageTask(this.#engine.state, task, candidates);
    if (!triage) throw new Error(NO_REPOSITORIES);
    const repo = await upsertRepo(this.#engine, triage.repoPath, this.#resolveLogin);
    await this.#engine.dispatch({
      type: 'task.triage',
      taskId,
      title: triage.title,
      repoId: repo.id,
      size: triage.size,
      branch: triage.branch,
      dependsOn: triage.dependsOn.map((dependency) => dependency.id),
    });
  }

  async #createWorktree(taskId: string) {
    const { task, repo } = this.#requireTask(taskId);
    if (task.stage !== 'triage' || !task.branch) return;
    if (task.worktreePath && existsSync(task.worktreePath)) {
      if (task.phaseReports.length === 0 && !task.pullRequest) await refreshWorktree(repo, task.worktreePath);
      await this.#engine.dispatch({
        type: 'worktree.ready',
        taskId,
        path: task.worktreePath,
        branch: task.branch,
      });
      return;
    }
    const worktree = await createWorktree(
      repo,
      this.#config.worktreesDir,
      taskId,
      task.branch,
      this.#resolveBaseBranch(task)
    );
    await this.#engine.dispatch({
      type: 'worktree.ready',
      taskId,
      path: worktree.path,
      branch: worktree.branch,
    });
  }

  async #runChecks(taskId: string) {
    const { task, repo } = this.#requireTask(taskId);
    if (task.stage !== 'checking' || !task.worktreePath) return;
    await this.#runs.quiesce(taskId);
    const results = await runChecks(repo, task.worktreePath);
    await this.#engine.dispatch({ type: 'checks.record', taskId, results });
  }

  async #pushHead(taskId: string, path: string, branch: string) {
    await this.#runs.quiesce(taskId);
    await pushBranch(path, branch);
    await this.#engine.dispatch({ type: 'pull_request.pushed', taskId, sha: await resolveHead(path) });
  }

  async #openPullRequest(taskId: string) {
    const { task, repo } = this.#requireTask(taskId);
    if (!task.worktreePath || !task.branch) throw new Error('The task has no worktree.');
    await this.#pushHead(taskId, task.worktreePath, task.branch);
    const pullRequest = await createPullRequest(repo, task, this.#resolveBaseBranch(task));
    if (!pullRequest) throw new Error('GitHub did not return the new pull request.');
    await this.#engine.dispatch({ type: 'pull_request.record', taskId, pullRequest });
    this.#syncSoon(taskId);
  }

  async #push(taskId: string) {
    const { task } = this.#requireTask(taskId);
    if (!task.worktreePath || !task.branch) throw new Error('The task has no worktree.');
    if (!task.pullRequest) {
      await this.#openPullRequest(taskId);
      return;
    }
    await this.#pushHead(taskId, task.worktreePath, task.branch);
    this.#syncSoon(taskId);
  }

  async #merge(taskId: string) {
    const { task, repo } = this.#requireTask(taskId);
    if (!task.pullRequest) throw new Error('There is no pull request to merge.');
    await mergePullRequest(repo, task.pullRequest.number, this.#engine.state.settings.mergeMethod);
    await this.syncPullRequest(taskId);
  }

  async #removeWorktree(taskId: string) {
    const task = this.#engine.state.tasks[taskId];
    const repo = task?.repoId ? this.#engine.state.repos[task.repoId] : undefined;
    if (!task?.worktreePath || !repo) return;
    try {
      await removeWorktree(repo, task.worktreePath);
    } catch (error) {
      log.warn('[Effects] Could not remove a worktree', { taskId, error: describeError(error) });
    }
    await this.#engine.dispatch({ type: 'worktree.gone', taskId });
  }
}
