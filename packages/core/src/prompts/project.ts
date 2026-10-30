import type { Repo, Task } from '../domain/index.ts';
import type { ShinsaState } from '../state/project.ts';
import { resolveTaskProject } from '../state/queries.ts';

function describeRepo(repo: Repo, current: string | null) {
  const here = repo.id === current ? ' (this task works here)' : '';
  return `- ${repo.name}: ${repo.path}${here}`;
}

function describeCrossRepositoryWork() {
  return [
    'Each task works in one repository and ships one pull request. When this change also needs code in another of these repositories:',
    '- Read that repository at its path to settle what the two sides share (an endpoint, a type, an SDK call). Change files only in your own worktree.',
    '- File the other part with `create_task`: `repository` set to it, `fork_from` set to this task so its agent starts from this conversation, and a request that says exactly what it changes there.',
    '- Set the order. `after_this` when the other part uses what this task adds, so it starts once this task merges. `this_task_waits` when this task needs the other part merged first; it is refused while you plan, so file that part in your first phase.',
    '- Say so in your plan and hand-over, and link the task for the human.',
  ].join('\n');
}

function hasOtherRepos(repos: Repo[], own: Repo | undefined) {
  return own !== undefined && repos.some((repo) => repo.id !== own.id);
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
    hasOtherRepos(repos, own) ? describeCrossRepositoryWork() : '',
  ]
    .filter((line, index) => index === 0 || line !== '')
    .join('\n');
}
