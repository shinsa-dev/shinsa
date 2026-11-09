import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BunServices } from '@effect/platform-bun';
import { Effect, Layer } from 'effect';
import { JsonFile } from '../../apps/engine/src/files/service.ts';
import { parseStoredService } from '../../apps/engine/src/terminals/store.ts';
import { TerminalFiles } from '../../apps/engine/src/terminals/store/service.ts';
import type { Project, Repo } from '../../packages/core/src/index.ts';
import { writeSeedServices } from './files.ts';
import { listSeedServices, SANDBOX_SERVICE_COMMAND } from './services.ts';

function createProject(id: string, name: string): Project {
  return { id, name, color: 'blue', key: name.slice(0, 3).toUpperCase(), description: '', folders: [] };
}

function createRepo(name: string, projectId: string): Repo {
  return {
    id: `repo-${name}`,
    name,
    path: `/seed/repos/${name}`,
    defaultBranch: 'main',
    remote: null,
    projectId,
    checkCommands: [],
  };
}

const PROJECTS = [
  createProject('project-superwall', 'Superwall'),
  createProject('project-basket', 'Basket'),
  createProject('project-personal', 'Personal'),
  createProject('project-sample', 'Sample'),
];

const REPOS = [
  createRepo('paywall-next', 'project-superwall'),
  createRepo('basket-server', 'project-basket'),
  createRepo('kanna', 'project-personal'),
  createRepo('shinsa-sample', 'project-sample'),
];

describe('listSeedServices', () => {
  test('gives every seeded project a web service and Superwall an api one', () => {
    const services = listSeedServices(PROJECTS, REPOS);
    for (const project of PROJECTS)
      expect(services.some((each) => each.projectId === project.id && each.name === 'web')).toBe(true);
    expect(
      services.filter((each) => each.projectId === 'project-superwall').map((each) => each.name)
    ).toEqual(['web', 'api']);
  });

  test('runs the sandbox dev server in its repository with a preview URL the engine accepts', () => {
    for (const service of listSeedServices(PROJECTS, REPOS)) {
      expect(parseStoredService(service)).toEqual(service);
      expect(service.previewUrl).toBe('http://localhost:{port}/');
      expect(service.command).toBe(SANDBOX_SERVICE_COMMAND);
      expect(REPOS.some((repo) => repo.path === service.cwd && repo.projectId === service.projectId)).toBe(
        true
      );
    }
    expect(new Set(listSeedServices(PROJECTS, REPOS).map((each) => each.id)).size).toBe(5);
  });

  test('refuses a seed whose repository is missing', () => {
    expect(() => listSeedServices(PROJECTS, REPOS.slice(1))).toThrow('No seeded paywall-next repository');
  });
});

describe('writeSeedServices', () => {
  test('writes the services where the engine reads them', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-services-'));
    const layer = TerminalFiles.layer.pipe(
      Layer.provideMerge(JsonFile.layer),
      Layer.provideMerge(BunServices.layer)
    );
    try {
      const { written, read } = await Effect.runPromise(
        Effect.gen(function* () {
          return {
            written: yield* writeSeedServices(dir, PROJECTS, REPOS),
            read: yield* TerminalFiles.use((files) => files.readServices(dir)),
          };
        }).pipe(Effect.provide(layer))
      );
      expect(read).toEqual(written);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
