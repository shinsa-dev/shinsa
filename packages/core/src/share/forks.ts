import type { Project, Repo, Task, TeammateFork } from '../domain/index.ts';
import { listForkRounds } from '../prompts/forks.ts';
import type { ShinsaState } from '../state/project.ts';

export interface TeammateForkSource {
  instanceId: string;
  task: Task;
  owner: string | null;
}

export function resolveTeammateFork({ instanceId, task, owner }: TeammateForkSource): TeammateFork {
  return {
    instanceId,
    taskId: task.id,
    handle: task.handle ?? null,
    title: task.title,
    owner,
    request: task.request,
    rounds: listForkRounds(task),
    branch: task.branch ?? null,
    pullRequest: task.pullRequest
      ? { number: task.pullRequest.number, url: task.pullRequest.url, state: task.pullRequest.state }
      : null,
  };
}

function isSameText(a: string | null | undefined, b: string | null | undefined) {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

export function listOwnRepos(state: Pick<ShinsaState, 'repos' | 'teammateRepos'>) {
  return Object.values(state.repos).filter((repo) => !state.teammateRepos?.[repo.id]);
}

export function findForkRepo(
  state: Pick<ShinsaState, 'repos' | 'projects' | 'teammateRepos'>,
  repo: Pick<Repo, 'name' | 'remote'> | null,
  project: Pick<Project, 'name'> | null
) {
  const own = listOwnRepos(state);
  const match =
    own.find((candidate) => isSameText(candidate.remote, repo?.remote)) ??
    own.find((candidate) => isSameText(candidate.name, repo?.name)) ??
    own.find((candidate) =>
      isSameText(candidate.projectId ? state.projects[candidate.projectId]?.name : null, project?.name)
    );
  return match?.id ?? null;
}
