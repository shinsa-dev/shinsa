import {
  isTaskSettled,
  needsRepository,
  needsWorktree,
  type Repo,
  resolveTaskPipeline,
  resolveTaskWorkspace,
  type Task,
} from '@shinsa/core';
import { Context, Effect, Layer } from 'effect';
import {
  createRepository,
  listCandidateRepos,
  prepareSetup,
  resolveTaskRepoTarget,
  upsertRepo,
  verifySetup,
} from '../../../repos/index.ts';
import { resolveRepoProject, type TriageResult } from '../../../triage/index.ts';
import { describeWorkspaceProblem } from '../../../workspaces/index.ts';
import type { EffectAttempt } from '../../engine/schema.ts';
import { createEffectFailed } from '../../failures/classify.ts';
import type { EffectFailure } from '../../failures/schema.ts';
import { NO_TRIAGE } from '../schema.ts';
import { EffectWorld } from '../world/service.ts';

export class TaskSetup extends Context.Service<
  TaskSetup,
  {
    triage(taskId: string, attempt: EffectAttempt): Effect.Effect<void, EffectFailure>;
    verify(taskId: string, attempt: EffectAttempt): Effect.Effect<void, EffectFailure>;
    createWorktree(taskId: string, attempt: EffectAttempt): Effect.Effect<void, EffectFailure>;
  }
>()('shinsa/engine/runtime/effects/setup/TaskSetup') {
  static readonly layer = Layer.effect(
    TaskSetup,
    Effect.gen(function* () {
      const world = yield* EffectWorld;

      const listCandidates = Effect.fn('TaskSetup.listCandidates')(function* (task: Task) {
        const roots = yield* world.bridge(() => world.roots.listRoots());
        return yield* world.bridge(() => listCandidateRepos(roots, task.origin));
      });

      const registerRepo = Effect.fn('TaskSetup.registerRepo')(function* (
        task: Task,
        path: string | null,
        attempt: EffectAttempt
      ) {
        if (!path) return null;
        const projectId = resolveRepoProject(yield* world.state, task, path);
        return yield* world.bridge(() =>
          upsertRepo(world.engine, path, world.resolveLogin, projectId, {
            id: `${attempt.key}:repo.register`,
          })
        );
      });

      const createTriagedRepo = Effect.fn('TaskSetup.createTriagedRepo')(function* (
        task: Task,
        name: string,
        attempt: EffectAttempt
      ) {
        const roots = yield* world.bridge(() => world.roots.listRoots());
        const target = resolveTaskRepoTarget(yield* world.state, task, name, roots);
        if (!target) {
          yield* Effect.logWarning(
            '[Triage] Triage named a new repository, but there is no folder to create it in'
          ).pipe(Effect.annotateLogs({ taskId: task.id, name }));
          return null;
        }
        return yield* world
          .bridge(() =>
            createRepository(world.engine, target.parent, name, target.projectId, {
              resolveLogin: world.resolveLogin,
              from: { id: `${attempt.key}:repo.register` },
            })
          )
          .pipe(
            Effect.catch((failure) =>
              Effect.logWarning('[Triage] Could not create the new repository triage named').pipe(
                Effect.annotateLogs({ taskId: task.id, name, error: failure.message }),
                Effect.as(null)
              )
            )
          );
      });

      const resolveTriagedRepo = Effect.fn('TaskSetup.resolveTriagedRepo')(function* (
        task: Task,
        triaged: TriageResult,
        attempt: EffectAttempt
      ) {
        if (triaged.repoPath === null && triaged.newRepo) {
          return yield* createTriagedRepo(task, triaged.newRepo, attempt);
        }
        return yield* registerRepo(task, triaged.repoPath, attempt);
      });

      const triage = Effect.fn('TaskSetup.triage')(function* (taskId: string, attempt: EffectAttempt) {
        const state = yield* world.state;
        const task = state.tasks[taskId];
        if (!task || isTaskSettled(task) || task.size !== null) return;
        const candidates = yield* listCandidates(task);
        const triaged = yield* world.bridge(() => world.triage(state, task, candidates));
        if (!triaged) return yield* createEffectFailed(NO_TRIAGE);
        const repo = yield* resolveTriagedRepo(task, triaged, attempt);
        yield* world.dispatch(
          {
            type: 'task.triage',
            taskId,
            title: triaged.title,
            repoId: repo?.id ?? null,
            size: triaged.size,
            branch: triaged.branch,
            waitsOn: triaged.waitsOn.map((dependency) => dependency.id),
            duplicateOf: triaged.duplicateOf,
            duplicateOfTeammate: triaged.duplicateOfTeammate,
            unreached: triaged.unreached,
            shape: triaged.shape,
            priority: triaged.priority,
            reasons: triaged.reasons,
          },
          { id: `${attempt.key}:task.triage` }
        );
      });

      const recordSetup = Effect.fn('TaskSetup.recordSetup')(function* (
        task: Task,
        repo: Repo,
        attempt: EffectAttempt,
        bind: boolean
      ) {
        const pipeline = resolveTaskPipeline(task);
        const started = needsWorktree(pipeline)
          ? yield* world.bridge((signal) => prepareSetup(repo, signal))
          : null;
        const problems = yield* world.bridge((signal) =>
          verifySetup(repo, { defaultBranch: needsWorktree(pipeline) }, signal)
        );
        if (needsWorktree(pipeline) && problems.every((problem) => problem.kind !== 'repository')) {
          const mode = resolveTaskWorkspace(yield* world.state, task);
          const workspace = yield* world.bridge((signal) =>
            describeWorkspaceProblem(repo, mode, task.worktreePath !== null, signal)
          );
          if (workspace) problems.push(workspace);
        }
        yield* world.dispatch(
          {
            type: 'config.record',
            taskId: task.id,
            problems,
            ...(bind ? { repoId: repo.id } : {}),
            ...(started ? { started } : {}),
          },
          { id: `${attempt.key}:config.record` }
        );
      });

      const findRepoPath = Effect.fn('TaskSetup.findRepoPath')(function* (task: Task) {
        if (!needsRepository(resolveTaskPipeline(task))) return null;
        const candidates = yield* listCandidates(task);
        const state = yield* world.state;
        return yield* world.bridge(() => world.findRepository(state, task, candidates));
      });

      const verifyUnbound = Effect.fn('TaskSetup.verifyUnbound')(function* (
        task: Task,
        attempt: EffectAttempt
      ) {
        if (task.stage !== 'triage') return;
        const repo = yield* registerRepo(task, yield* findRepoPath(task), attempt);
        if (!repo) {
          yield* world.dispatch(
            { type: 'config.record', taskId: task.id, problems: [] },
            { id: `${attempt.key}:config.record` }
          );
          return;
        }
        yield* recordSetup(task, repo, attempt, true);
      });

      const verify = Effect.fn('TaskSetup.verify')(function* (taskId: string, attempt: EffectAttempt) {
        const unbound = (yield* world.state).tasks[taskId];
        if (unbound && unbound.repoId === null) return yield* verifyUnbound(unbound, attempt);
        const { task, repo } = yield* world.findTask(taskId);
        if (task.stage !== 'triage') return;
        yield* recordSetup(task, repo, attempt, false);
      });

      const createWorktree = Effect.fn('TaskSetup.createWorktree')(function* (
        taskId: string,
        attempt: EffectAttempt
      ) {
        const { task, repo } = yield* world.findTask(taskId);
        if (task.stage !== 'triage' || !task.branch) return;
        const worktree = yield* world.bridge((signal) =>
          world.workspaces.resolve(task).prepare(repo, task, signal)
        );
        yield* world.dispatch(
          {
            type: 'worktree.ready',
            taskId,
            path: worktree.path,
            branch: worktree.branch,
            ...(worktree.returnBranch === undefined ? {} : { returnBranch: worktree.returnBranch }),
          },
          { id: `${attempt.key}:worktree.ready` }
        );
      });

      return TaskSetup.of({ triage, verify, createWorktree });
    })
  );
}
