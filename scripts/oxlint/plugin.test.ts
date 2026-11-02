import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import plugin, { SHINSA_RULES } from './plugin.ts';

const ROOT = resolve(import.meta.dir, '../..');
const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

interface OxlintConfig {
  readonly jsPlugins: readonly string[];
  readonly rules: Record<string, unknown>;
  readonly overrides: readonly { readonly rules: Record<string, unknown> }[];
}

describe('the Shinsa Oxlint plugin', () => {
  test('the repository config turns on every rule the plugin has, and only those', () => {
    const config = JSON.parse(readFileSync(join(ROOT, '.oxlintrc.json'), 'utf8')) as OxlintConfig;
    const configured = [config.rules, ...config.overrides.map((override) => override.rules)]
      .flatMap((rules) => Object.keys(rules))
      .filter((name) => name.startsWith('shinsa/'))
      .map((name) => name.slice('shinsa/'.length));
    expect(config.jsPlugins).toEqual(['./scripts/oxlint/plugin.ts']);
    expect([...new Set(configured)].sort()).toEqual(Object.keys(SHINSA_RULES).sort());
    expect(plugin.meta.name).toBe('shinsa');
  });

  test('Oxlint loads it and reports through it, with the parents its rules read', () => {
    const folder = mkdtempSync(join(tmpdir(), 'shinsa-oxlint-'));
    folders.push(folder);
    writeFileSync(
      join(folder, '.oxlintrc.json'),
      JSON.stringify({
        jsPlugins: [join(ROOT, 'scripts/oxlint/plugin.ts')],
        categories: { correctness: 'off' },
        rules: {
          'shinsa/no-useless-continue': 'error',
          'shinsa/use-template': 'error',
          'shinsa/no-this-in-static': 'error',
        },
      })
    );
    writeFileSync(
      join(folder, 'sample.ts'),
      [
        'for (const a of list) { continue; }',
        "export const b = 'x' + list;",
        'export class C { static d() { return this; } }',
      ].join('\n')
    );
    const run = Bun.spawnSync([join(ROOT, 'node_modules/.bin/oxlint'), '-f', 'unix', '.'], { cwd: folder });
    const output = run.stdout.toString();
    expect(output).toContain('sample.ts:1:');
    expect(output).toContain('shinsa(no-useless-continue)');
    expect(output).toContain('shinsa(use-template)');
    expect(output).toContain('shinsa(no-this-in-static)');
    expect(run.exitCode).toBe(1);
  });
});
