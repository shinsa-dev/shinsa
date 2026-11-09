import { describe, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { ServiceSuggestion } from '@shinsa/core';
import {
  expandWorkspaces,
  listServiceSuggestions as listSuggestionsEffect,
  parseCargoName,
  parseComposeServices,
  parseDenoTasks,
  parseMakeTarget,
  parsePackageFile,
  parsePnpmWorkspaces,
  parseProcfile,
} from '../../src/terminals/detect.ts';
import { runFiles } from '../harness.ts';
import { createTempDir } from '../helpers/index.ts';

const DETECTED = { previewUrl: null, portVariable: 'PORT' };

function writeFiles(root: string, files: Record<string, unknown>) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return root;
}

function listServiceSuggestions(roots: string[]): Promise<ServiceSuggestion[]> {
  return runFiles(listSuggestionsEffect(roots));
}

async function listFound(root: string) {
  return (await listServiceSuggestions([root])).map((each) => [each.name, each.command, each.recommended]);
}

describe('listServiceSuggestions', () => {
  it('offers each workspace’s dev script in a monorepo, named after its package, and the root’s as “all”', async () => {
    const root = writeFiles(createTempDir(), {
      'package.json': {
        workspaces: ['apps/*', 'packages/*', '!packages/skip'],
        scripts: { dev: 'turbo dev' },
      },
      'bun.lock': '',
      'apps/api/package.json': { name: '@shop/api', scripts: { dev: 'bun --watch src/index.ts' } },
      'apps/web/package.json': { name: '@shop/web', scripts: { dev: 'vite' } },
      'apps/docs/package.json': { scripts: { build: 'astro build' } },
      'apps/node_modules/package.json': {},
      'apps/README.md': 'not a folder',
      'packages/ui/package.json': { scripts: { dev: 'tsc -w' } },
    });
    expect(await listServiceSuggestions([root])).toEqual([
      {
        name: 'api',
        cwd: join(root, 'apps/api'),
        command: 'bun run dev',
        source: 'package',
        recommended: true,
        ...DETECTED,
      },
      {
        name: 'web',
        cwd: join(root, 'apps/web'),
        command: 'bun run dev',
        source: 'package',
        recommended: true,
        ...DETECTED,
      },
      {
        name: 'ui',
        cwd: join(root, 'packages/ui'),
        command: 'bun run dev',
        source: 'package',
        recommended: false,
        ...DETECTED,
      },
      { name: 'all', cwd: root, command: 'bun run dev', source: 'package', recommended: false, ...DETECTED },
    ]);
  });

  it('falls back to start and then serve, and to apps/* and packages/* when no workspaces are named', async () => {
    const root = writeFiles(createTempDir(), {
      'package.json': { name: 'turbo-shop' },
      'package-lock.json': '',
      'apps/site/package.json': { scripts: { start: 'next start', build: 'next build' } },
      'apps/docs/package.json': { scripts: { serve: 'docusaurus serve' } },
      'services/queue/package.json': { scripts: { dev: 'node --watch .' } },
    });
    expect(await listFound(root)).toEqual([
      ['docs', 'npm run serve', true],
      ['site', 'npm run start', true],
      ['queue', 'npm run dev', true],
    ]);
    const single = writeFiles(createTempDir(), { 'package.json': { name: 'one', scripts: { start: 'x' } } });
    expect(await listFound(single)).toEqual([['one', 'npm run start', true]]);
  });

  it('follows the package manager the lockfile or packageManager names, and pnpm’s workspace file', async () => {
    const pnpm = writeFiles(createTempDir(), {
      'package.json': { name: 'shop' },
      'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n  - \"tools/cli\" # the cli\nother:\n  - 'x/*'\n",
      'pnpm-lock.yaml': '',
      'apps/site/package.json': { scripts: { dev: 'next dev' } },
      'tools/cli/package.json': { name: 'cli', scripts: { dev: 'tsx watch' } },
    });
    expect((await listServiceSuggestions([pnpm])).map((each) => [each.name, each.command])).toEqual([
      ['site', 'pnpm run dev'],
      ['cli', 'pnpm run dev'],
    ]);
    const yarn = writeFiles(createTempDir(), { 'package.json': { name: 'one', scripts: { dev: 'x' } } });
    writeFileSync(join(yarn, 'yarn.lock'), '');
    expect((await listServiceSuggestions([yarn]))[0]).toMatchObject({ name: 'one', command: 'yarn run dev' });
    const named = writeFiles(createTempDir(), {
      'package.json': { packageManager: 'pnpm@9.1.0', scripts: { dev: 'x' } },
    });
    expect((await listServiceSuggestions([named]))[0]?.command).toBe('pnpm run dev');
    const plain = writeFiles(createTempDir(), {
      'package.json': { packageManager: 'deno@2', workspaces: { packages: ['lib'] }, scripts: { dev: 'x' } },
      'lib/package.json': { scripts: { dev: 'y' } },
    });
    expect(await listFound(plain)).toEqual([
      ['lib', 'npm run dev', false],
      ['all', 'npm run dev', false],
    ]);
  });

  it('reads a Procfile, each Compose service, and tells apart two services of the same name', async () => {
    const one = writeFiles(createTempDir(), {
      Procfile: 'web: bundle exec puma\nworker: sidekiq\n# comment\nnot a line\n',
      'compose.yaml':
        'services:\n  db:\n    image: postgres\n  cache: # redis\n    image: redis\nvolumes:\n  data:\n',
    });
    const two = writeFiles(createTempDir(), { 'package.json': { name: 'web', scripts: { dev: 'x' } } });
    expect((await listServiceSuggestions([one, two])).map((each) => [each.name, each.command])).toEqual([
      [expect.stringMatching(/-web$/), 'bundle exec puma'],
      ['worker', 'sidekiq'],
      ['db', 'docker compose up db'],
      ['cache', 'docker compose up cache'],
      [expect.stringMatching(/-web$/), 'npm run dev'],
    ]);
    const empty = writeFiles(createTempDir(), { 'docker-compose.yml': 'services: {}' });
    expect(await listFound(empty)).toEqual([['compose', 'docker compose up', true]]);
    expect(await listServiceSuggestions([createTempDir()])).toEqual([]);
  });

  it('prefers bin/dev, then Procfile.dev, to the production Procfile', async () => {
    const rails = writeFiles(createTempDir(), {
      'bin/dev': '#!/bin/sh',
      'Procfile.dev': 'web: rails s',
      Procfile: 'web: puma',
    });
    expect(await listFound(rails)).toEqual([[basename(rails), 'bin/dev', true]]);
    const foreman = writeFiles(createTempDir(), {
      'Procfile.dev': 'css: tailwind -w',
      Procfile: 'web: puma',
    });
    expect(await listFound(foreman)).toEqual([['css', 'tailwind -w', true]]);
  });

  it('finds Deno tasks, a Cargo binary, Go commands and Django, and make only when nothing else is there', async () => {
    const deno = writeFiles(createTempDir(), { 'deno.json': { tasks: { start: 'deno run main.ts' } } });
    expect(await listFound(deno)).toEqual([[basename(deno), 'deno task start', true]]);
    const denoless = writeFiles(createTempDir(), { 'deno.jsonc': '{ // tasks\n}' });
    expect(await listFound(denoless)).toEqual([]);
    const both = writeFiles(createTempDir(), { 'deno.json': { tasks: { dev: 'x' } }, 'package.json': {} });
    expect(await listFound(both)).toEqual([]);

    const cargo = writeFiles(createTempDir(), {
      'Cargo.toml': '[package]\nname = "api-server"\nversion = "0.1.0"\n\n[dependencies]\nname = "x"\n',
      'src/main.rs': 'fn main() {}',
    });
    expect(await listFound(cargo)).toEqual([['api-server', 'cargo run', true]]);
    const unnamed = writeFiles(createTempDir(), { 'Cargo.toml': '', 'src/main.rs': '' });
    expect(await listFound(unnamed)).toEqual([[basename(unnamed), 'cargo run', true]]);
    const workspace = writeFiles(createTempDir(), { 'Cargo.toml': '[workspace]\n', 'src/main.rs': '' });
    expect(await listFound(workspace)).toEqual([]);

    const go = writeFiles(createTempDir(), {
      'go.mod': 'module shop',
      'main.go': 'package main',
      'cmd/worker/main.go': 'package main',
      'cmd/notes/README.md': '',
    });
    expect(await listFound(go)).toEqual([
      [basename(go), 'go run .', true],
      ['worker', 'go run ./cmd/worker', true],
    ]);
    const tools = writeFiles(createTempDir(), { 'go.mod': '', 'cmd/api/main.go': '' });
    expect(await listFound(tools)).toEqual([['api', 'go run ./cmd/api', true]]);

    const django = writeFiles(createTempDir(), { 'manage.py': '' });
    expect(await listFound(django)).toEqual([[basename(django), 'python manage.py runserver', true]]);

    const make = writeFiles(createTempDir(), {
      Makefile: 'VAR := 1\nbuild:\n\tgo build\nserve: build\n\t./x\n',
    });
    expect(await listFound(make)).toEqual([[basename(make), 'make serve', true]]);
    const covered = writeFiles(createTempDir(), { Makefile: 'dev:\n\tx\n', 'manage.py': '' });
    expect(await listFound(covered)).toEqual([[basename(covered), 'python manage.py runserver', true]]);
  });

  it('names a nested duplicate by its folder', async () => {
    const root = writeFiles(createTempDir(), {
      'package.json': { workspaces: ['apps/*', 'tools/*'] },
      'apps/web/package.json': { name: 'web', scripts: { dev: 'x' } },
      'tools/web/package.json': { name: 'web', scripts: { dev: 'y' } },
    });
    expect((await listServiceSuggestions([root])).map((each) => each.name)).toEqual([
      'apps/web',
      'tools/web',
    ]);
  });
});

describe('the readers', () => {
  it('reads a package file leniently', async () => {
    expect(parsePackageFile(null)).toBeNull();
    expect(parsePackageFile('{')).toBeNull();
    expect(parsePackageFile('3')).toBeNull();
    expect(parsePackageFile('{"scripts":{"dev":3,"start":"node ."},"workspaces":[1,"a"]}')).toEqual({
      name: null,
      scripts: { start: 'node .' },
      workspaces: ['a'],
      packageManager: null,
    });
    expect(parsePackageFile('{"workspaces":"apps"}')?.workspaces).toEqual([]);
  });

  it('reads pnpm’s workspace list, a Procfile, Compose services, Deno tasks, make targets and a crate name', () => {
    expect(parsePnpmWorkspaces(null)).toEqual([]);
    expect(parseProcfile(null)).toEqual([]);
    expect(parseProcfile('api:  node server.js  ')).toEqual([{ name: 'api', command: 'node server.js' }]);
    expect(parseComposeServices(null)).toEqual([]);
    expect(parseComposeServices('services:\n    web:\n      ports:\n        - "80"\n    db:\n')).toEqual([
      'web',
      'db',
    ]);
    expect(parseDenoTasks(null)).toEqual({});
    expect(parseDenoTasks('{"tasks":{"dev":"x","n":1}}')).toEqual({ dev: 'x' });
    expect(parseMakeTarget(null)).toBeNull();
    expect(parseMakeTarget('dev := 1\nall:\n')).toBeNull();
    expect(parseCargoName(null)).toBeNull();
    expect(parseCargoName('[package]\nname = "last"')).toBe('last');
  });

  it('expands exact folders and skips the ones that are missing', async () => {
    const root = writeFiles(createTempDir(), { 'lib/package.json': {} });
    expect(await runFiles(expandWorkspaces(root, ['./lib/', 'missing', 'gone/*']))).toEqual([
      join(root, 'lib'),
    ]);
  });
});
