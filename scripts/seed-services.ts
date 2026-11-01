import { join } from 'node:path';
import { TerminalStore } from '../apps/engine/src/terminals/store.ts';
import type { Project, Repo, ServiceDefinition } from '../packages/core/src/index.ts';

export const SANDBOX_SERVICE_COMMAND = `bun ${join(import.meta.dir, 'sandbox-service.ts')}`;

const SEED_SERVICES = [
  { projectId: 'project-superwall', repo: 'paywall-next', name: 'web' },
  { projectId: 'project-superwall', repo: 'paywall-next', name: 'api' },
  { projectId: 'project-basket', repo: 'basket-server', name: 'web' },
  { projectId: 'project-personal', repo: 'kanna', name: 'web' },
  { projectId: 'project-sample', repo: 'shinsa-sample', name: 'web' },
];

export function listSeedServices(projects: readonly Project[], repos: readonly Repo[]): ServiceDefinition[] {
  return SEED_SERVICES.map((entry) => {
    const project = projects.find((each) => each.id === entry.projectId);
    const repo = repos.find((each) => each.name === entry.repo && each.projectId === entry.projectId);
    if (!(project && repo)) throw new Error(`No seeded ${entry.repo} repository in ${entry.projectId}.`);
    return {
      id: `service-${entry.projectId.replace('project-', '')}-${entry.name}`,
      projectId: project.id,
      name: entry.name,
      cwd: repo.path,
      command: SANDBOX_SERVICE_COMMAND,
      env: { SANDBOX_SERVICE: entry.name, SANDBOX_PROJECT: project.name },
      previewUrl: 'http://localhost:{port}/',
      portVariable: 'PORT',
    };
  });
}

export function writeSeedServices(dataDir: string, projects: readonly Project[], repos: readonly Repo[]) {
  const services = listSeedServices(projects, repos);
  new TerminalStore(dataDir).writeServices(services);
  return services;
}
