import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  listDependencyNames,
  listWorkspacePatterns,
  parseDenoTasks,
  parsePackageManifest,
  readPackageManifest,
} from '../../src/files/manifest.ts';
import { createTempDir } from '../helpers/index.ts';

describe('a package.json', () => {
  test('keeps the fields it can read and drops the ones that break their shape', () => {
    const manifest = parsePackageManifest(
      JSON.stringify({
        name: 7,
        packageManager: 'pnpm@9',
        scripts: { dev: 'vite', broken: 3 },
        dependencies: { react: '19' },
        devDependencies: 'none',
        workspaces: ['apps/*', 4],
      })
    );
    expect(manifest).toEqual({
      packageManager: 'pnpm@9',
      scripts: { dev: 'vite' },
      dependencies: { react: '19' },
      workspaces: ['apps/*'],
    });
    expect(parsePackageManifest(JSON.stringify({ workspaces: { packages: ['packages/*', null] } }))).toEqual({
      workspaces: { packages: ['packages/*'] },
    });
    expect(parsePackageManifest(JSON.stringify({ workspaces: 'apps/*' }))).toEqual({});
    expect(
      parsePackageManifest(
        JSON.stringify({ packageManager: 1, scripts: [], dependencies: 2, workspaces: { packages: 'x' } })
      )
    ).toEqual({ workspaces: {} });
  });

  test('lists its workspace patterns, from either way of writing them', () => {
    expect(listWorkspacePatterns({ workspaces: ['apps/*'] })).toEqual(['apps/*']);
    expect(listWorkspacePatterns({ workspaces: { packages: ['packages/*'] } })).toEqual(['packages/*']);
    expect(listWorkspacePatterns({ workspaces: {} })).toEqual([]);
    expect(listWorkspacePatterns({})).toEqual([]);
  });

  test('reads the tasks of a deno.json, dropping the ones that are not commands', () => {
    expect(parseDenoTasks(JSON.stringify({ tasks: { dev: 'deno run -A main.ts', bad: 1 } }))).toEqual({
      dev: 'deno run -A main.ts',
    });
    expect(parseDenoTasks(JSON.stringify({ tasks: 3 }))).toEqual({});
    expect(parseDenoTasks('{')).toEqual({});
    expect(parseDenoTasks(null)).toEqual({});
  });

  test('text that is not an object, or no text, is no manifest', () => {
    expect(parsePackageManifest('{')).toBeNull();
    expect(parsePackageManifest('null')).toBeNull();
    expect(parsePackageManifest('[1]')).toBeNull();
    expect(parsePackageManifest(null)).toBeNull();
  });

  test('is read from a folder, and a folder without one, or with a folder in its place, has none', () => {
    const dir = createTempDir();
    expect(readPackageManifest(dir)).toBeNull();
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'app', devDependencies: { vitest: '3' } })
    );
    const manifest = readPackageManifest(dir);
    expect(manifest?.name).toBe('app');
    expect(manifest ? listDependencyNames(manifest) : []).toEqual(['vitest']);
    const nested = join(dir, 'nested');
    mkdirSync(join(nested, 'package.json'), { recursive: true });
    expect(readPackageManifest(nested)).toBeNull();
  });
});
