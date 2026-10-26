import { describe, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  expandWorkspaces,
  listServiceSuggestions,
  parsePackageFile,
  parsePnpmWorkspaces,
  parseProcfile,
} from '../../src/terminals/detect.ts';
import { createTempDir } from '../helpers/index.ts';

function writeFiles(root: string, files: Record<string, unknown>) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return root;
}

describe('listServiceSuggestions', () => {
  it('offers each workspace’s dev script in a monorepo, named after its package, and the root’s as “all”', () => {
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
    expect(listServiceSuggestions([root])).toEqual([
      { name: 'api', cwd: join(root, 'apps/api'), command: 'bun run dev', source: 'package' },
      { name: 'web', cwd: join(root, 'apps/web'), command: 'bun run dev', source: 'package' },
      { name: 'ui', cwd: join(root, 'packages/ui'), command: 'bun run dev', source: 'package' },
      { name: 'all', cwd: root, command: 'bun run dev', source: 'package' },
    ]);
  });

  it('follows the package manager the lockfile or packageManager names, and pnpm’s workspace file', () => {
    const pnpm = writeFiles(createTempDir(), {
      'package.json': { name: 'shop' },
      'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n  - \"tools/cli\" # the cli\nother:\n  - 'x/*'\n",
      'pnpm-lock.yaml': '',
      'apps/site/package.json': { scripts: { dev: 'next dev' } },
      'tools/cli/package.json': { name: 'cli', scripts: { dev: 'tsx watch' } },
    });
    expect(listServiceSuggestions([pnpm]).map((each) => [each.name, each.command])).toEqual([
      ['site', 'pnpm run dev'],
      ['cli', 'pnpm run dev'],
    ]);
    const yarn = writeFiles(createTempDir(), { 'package.json': { name: 'one', scripts: { dev: 'x' } } });
    writeFileSync(join(yarn, 'yarn.lock'), '');
    expect(listServiceSuggestions([yarn])[0]).toMatchObject({ name: 'one', command: 'yarn run dev' });
    const named = writeFiles(createTempDir(), {
      'package.json': { packageManager: 'pnpm@9.1.0', scripts: { dev: 'x' } },
    });
    expect(listServiceSuggestions([named])[0]?.command).toBe('pnpm run dev');
    const plain = writeFiles(createTempDir(), {
      'package.json': { packageManager: 'deno@2', workspaces: { packages: ['lib'] }, scripts: { dev: 'x' } },
      'lib/package.json': { scripts: { dev: 'y' } },
    });
    expect(listServiceSuggestions([plain]).map((each) => [each.name, each.command])).toEqual([
      ['lib', 'npm run dev'],
      ['all', 'npm run dev'],
    ]);
  });

  it('reads a Procfile and offers docker compose, and tells apart two services of the same name', () => {
    const one = writeFiles(createTempDir(), {
      Procfile: 'web: bundle exec puma\nworker: sidekiq\n# comment\nnot a line\n',
      'compose.yaml': 'services: {}',
    });
    const two = writeFiles(createTempDir(), { 'package.json': { name: 'web', scripts: { dev: 'x' } } });
    const names = listServiceSuggestions([one, two]).map((each) => each.name);
    expect(names).toEqual([
      expect.stringMatching(/-web$/),
      'worker',
      'compose',
      expect.stringMatching(/-web$/),
    ]);
    expect(listServiceSuggestions([createTempDir()])).toEqual([]);
  });

  it('names a nested duplicate by its folder', () => {
    const root = writeFiles(createTempDir(), {
      'package.json': { workspaces: ['apps/*', 'tools/*'] },
      'apps/web/package.json': { name: 'web', scripts: { dev: 'x' } },
      'tools/web/package.json': { name: 'web', scripts: { dev: 'y' } },
    });
    expect(listServiceSuggestions([root]).map((each) => each.name)).toEqual(['apps/web', 'tools/web']);
  });
});

describe('the readers', () => {
  it('reads a package file leniently', () => {
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

  it('reads pnpm’s workspace list and a Procfile', () => {
    expect(parsePnpmWorkspaces(null)).toEqual([]);
    expect(parseProcfile(null)).toEqual([]);
    expect(parseProcfile('api:  node server.js  ')).toEqual([{ name: 'api', command: 'node server.js' }]);
  });

  it('expands exact folders and skips the ones that are missing', () => {
    const root = writeFiles(createTempDir(), { 'lib/package.json': {} });
    expect(expandWorkspaces(root, ['./lib/', 'missing', 'gone/*'])).toEqual([join(root, 'lib')]);
  });
});
