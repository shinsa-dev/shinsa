import { DomainError, type Focus, type Gate, type RunAccount, selectProjectByReference } from '@shinsa/core';
import type { ProjectView } from '@shinsa/core/engine-api/schema';
import { Effect, Option } from 'effect';
import type { resolveTaskView } from '../http/task-views.ts';
import type { SurfaceClient } from './schema.ts';

export type TaskView = ReturnType<typeof resolveTaskView>;

export type { ProjectView };

export interface ProjectsRead {
  readonly projects: readonly ProjectView[];
  readonly focus: Focus;
}

export function readTask(client: SurfaceClient, ref: string) {
  return client.api.tasks.read({ params: { taskRef: ref } });
}

export const findTaskId = Effect.fn('Surface.findTaskId')(function* (client: SurfaceClient, ref: string) {
  const detail = yield* readTask(client, ref);
  return detail.task.id;
});

export const findTaskIds = Effect.fn('Surface.findTaskIds')(function* (
  client: SurfaceClient,
  refs: string[]
) {
  return yield* Effect.forEach(refs, (ref) => findTaskId(client, ref), { concurrency: 'unbounded' });
});

export const findOpenGate = Effect.fn('Surface.findOpenGate')(function* (
  client: SurfaceClient,
  ref: string,
  describe: string,
  predicate: (gate: Gate) => boolean
) {
  const detail = yield* readTask(client, ref);
  const gate = detail.gates.find(predicate);
  if (!gate) {
    return yield* new DomainError({
      code: 'gate_not_found',
      message: `“${detail.task.title}” has no ${describe} waiting.`,
    });
  }
  return gate;
});

export const findMergeStep = Effect.fn('Surface.findMergeStep')(function* (
  client: SurfaceClient,
  ref: string,
  step: string
) {
  const detail = yield* readTask(client, ref);
  const steps = detail.mergeSteps;
  const wanted = step.trim().toLowerCase();
  const found =
    steps[Number(wanted) - 1] ??
    steps.find((candidate) => candidate.key === step || candidate.title.toLowerCase() === wanted);
  if (found) return { taskId: detail.task.id, step: found };
  return yield* new DomainError({
    code: 'merge_step_not_found',
    message:
      steps.length === 0
        ? `“${detail.task.title}” has no steps around the merge.`
        : `“${detail.task.title}” has no step ${step}. \`shinsa tasks show\` lists its steps, numbered from 1.`,
  });
});

export const findWatchdog = Effect.fn('Surface.findWatchdog')(function* (
  client: SurfaceClient,
  ref: string,
  watchdog: string
) {
  const detail = yield* readTask(client, ref);
  const watchdogs = detail.watchdogs;
  const wanted = watchdog.trim().toLowerCase();
  const found =
    watchdogs[Number(wanted) - 1] ??
    watchdogs.find((candidate) => candidate.id === watchdog || candidate.title.toLowerCase() === wanted);
  if (found) return { taskId: detail.task.id, watchdog: found };
  return yield* new DomainError({
    code: 'watchdog_not_found',
    message:
      watchdogs.length === 0
        ? `“${detail.task.title}” has no watchdogs.`
        : `“${detail.task.title}” has no watchdog ${watchdog}. \`shinsa tasks show\` lists them, numbered from 1.`,
  });
});

export const findAccount = Effect.fn('Surface.findAccount')(function* (client: SurfaceClient, ref: string) {
  const snapshot = yield* client.api.accounts.list();
  const lower = ref.toLowerCase();
  const account = snapshot.accounts.find(
    (candidate) => candidate.id === ref || candidate.email?.toLowerCase() === lower
  );
  if (!account) {
    return yield* new DomainError({
      code: 'account_not_found',
      message: `No account ${ref}. \`shinsa accounts list\` lists them.`,
    });
  }
  const found: RunAccount = { id: account.id, email: account.email };
  return found;
});

export const findRepoId = Effect.fn('Surface.findRepoId')(function* (client: SurfaceClient, ref: string) {
  const { repos } = yield* client.api.state.repos();
  const repo = repos.find((candidate) => candidate.id === ref || candidate.name === ref);
  if (!repo) {
    return yield* new DomainError({
      code: 'repo_not_found',
      message: `No repository ${ref}. \`shinsa repos list\` lists them.`,
    });
  }
  return repo.id;
});

export function selectProject(projects: readonly ProjectView[], ref: string) {
  return Option.getOrNull(selectProjectByReference(projects, ref));
}

export const findProject = Effect.fn('Surface.findProject')(function* (client: SurfaceClient, ref: string) {
  const { projects } = yield* client.api.state.projects();
  const project = selectProject(projects, ref);
  if (!project) {
    return yield* new DomainError({
      code: 'project_not_found',
      message: `No project ${ref}. \`shinsa projects list\` lists them.`,
    });
  }
  return project;
});

export const findProjectId = Effect.fn('Surface.findProjectId')(function* (
  client: SurfaceClient,
  ref: string
) {
  const project = yield* findProject(client, ref);
  return project.id;
});

export function resolveOptionalAccount(client: SurfaceClient, ref: string) {
  return ref ? findAccount(client, ref) : Effect.succeed(null);
}

export function resolveOptionalRepoId(client: SurfaceClient, ref: string) {
  return ref ? findRepoId(client, ref) : Effect.succeed(null);
}

export function resolveOptionalTaskId(client: SurfaceClient, ref: string) {
  return ref ? findTaskId(client, ref) : Effect.succeed(null);
}

export function resolveOptionalProjectId(client: SurfaceClient, ref: string) {
  return ref ? findProjectId(client, ref) : Effect.succeed(null);
}
