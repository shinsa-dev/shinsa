import type { LocalRepoView } from '@shinsa/core/engine-api/schema';
import { Effect } from 'effect';
import { runApp } from '@/lib/runtime/app.ts';
import { EngineClient } from '@/lib/runtime/engine/service.ts';

export type LocalRepo = LocalRepoView;

const listLocalRepos = Effect.gen(function* () {
  const engine = yield* EngineClient;
  const answer = yield* engine.projects.localRepos();
  return [...answer.repos];
});

const addRepo = Effect.fn('Projects.addRepo')(function* (projectId: string, path: string) {
  const engine = yield* EngineClient;
  const answer = yield* engine.projects.addRepo({ params: { projectId }, payload: { path } });
  return answer.repo;
});

const addFolder = Effect.fn('Projects.addFolder')(function* (projectId: string, path: string) {
  const engine = yield* EngineClient;
  const answer = yield* engine.projects.addFolder({ params: { projectId }, payload: { path } });
  return answer.project;
});

export function requestLocalRepos() {
  return runApp(listLocalRepos);
}

export function requestAddProjectRepo(projectId: string, path: string) {
  return runApp(addRepo(projectId, path));
}

export function requestAddProjectFolder(projectId: string, path: string) {
  return runApp(addFolder(projectId, path));
}
