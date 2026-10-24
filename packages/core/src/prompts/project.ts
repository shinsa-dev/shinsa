import type { Repo, Task } from '../domain/index.ts';
import type { ShinsaState } from '../state/project.ts';
import { resolveTaskProject } from '../state/queries.ts';

function describeRepo(repo: Repo, current: string | null) {
  const here = repo.id === current ? ' (this task works here)' : '';
  return `- ${repo.name}: ${repo.path}${here}`;
}

export function resolveProjectContext(state: ShinsaState, task: Task) {
  const projectId = resolveTaskProject(state, task);
  const project = projectId ? state.projects[projectId] : undefined;
  if (!project) return '';
  const repos = Object.values(state.repos)
    .filter((repo) => repo.projectId === project.id)
    .sort((a, b) => a.name.localeCompare(b.name));
  const own = task.repoId ? state.repos[task.repoId] : undefined;
  return [
    '',
    `This task belongs to the project ${project.name} (tasks ${project.key}-1, ${project.key}-2 and so on). When the human says "the project", "the app" or "the server", they mean this project's repositories, so you do not need to ask which one.`,
    project.description ? `About the project: ${project.description}` : '',
    repos.length > 0
      ? ['Its repositories:', ...repos.map((repo) => describeRepo(repo, task.repoId))].join('\n')
      : '',
    project.folders.length > 0
      ? `Its folders (every repository in them belongs to it): ${project.folders.join(', ')}`
      : '',
    own && own.projectId !== project.id
      ? `This task works in ${own.name} (${own.path}), a repository outside the project.`
      : '',
  ]
    .filter((line, index) => index === 0 || line !== '')
    .join('\n');
}
