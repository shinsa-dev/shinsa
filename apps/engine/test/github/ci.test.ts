import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isCheckWorkflow, RepoCiCache, readRepoCi } from '../../src/github/ci.ts';
import { createTempDir, overrideEnv } from '../helpers/index.ts';
import { createRepo } from '../helpers/state.ts';

interface FakeCi {
  workflows?: Record<string, string>;
  requiredChecks?: string[];
  rulesetChecks?: string[];
  baseChecks?: boolean;
}

const restores: (() => void)[] = [];

afterEach(() => {
  for (const restore of restores.splice(0).reverse()) restore();
});

function useFakeGitHub(ci: FakeCi = {}) {
  const path = join(createTempDir(), 'gh.json');
  writeFileSync(path, JSON.stringify({ next: 1, defaultChecks: 'pending', pulls: [], calls: [], ...ci }));
  restores.push(overrideEnv({ FAKE_GH_STATE: path }));
  return { calls: () => (JSON.parse(readFileSync(path, 'utf8')) as { calls: string[][] }).calls };
}

function useBrokenGitHub(failing: string) {
  const dir = createTempDir();
  const real = join(import.meta.dirname, '../helpers/bin/gh');
  writeFileSync(
    join(dir, 'gh'),
    `#!/bin/sh\ncase "$*" in *${failing}*) echo "HTTP 404: Not Found" >&2; exit 1;; esac\nexec "${real}" "$@"\n`,
    { mode: 0o755 }
  );
  restores.push(overrideEnv({ PATH: `${dir}:${process.env.PATH ?? ''}` }));
}

const repo = () => createRepo({ path: createTempDir() });

const PULL_REQUEST_WORKFLOW = 'on:\n  pull_request:\n    branches: [main]\njobs: {}\n';

describe('which workflows produce checks', () => {
  test('a workflow that runs on a push or a pull request does, in every way YAML can say it', () => {
    expect(isCheckWorkflow(PULL_REQUEST_WORKFLOW)).toBe(true);
    expect(isCheckWorkflow('on: push\n')).toBe(true);
    expect(isCheckWorkflow('on: [workflow_dispatch, pull_request_target]\n')).toBe(true);
  });

  test('a workflow that only runs on a schedule or by hand does not', () => {
    expect(isCheckWorkflow('on:\n  schedule:\n    - cron: "0 0 * * *"\n')).toBe(false);
    expect(isCheckWorkflow('on: [workflow_dispatch, 3]\n')).toBe(false);
    expect(isCheckWorkflow('name: Release\n')).toBe(false);
    expect(isCheckWorkflow('on: 3\n')).toBe(false);
  });

  test('a workflow Shinsa cannot read is taken to produce checks', () => {
    expect(isCheckWorkflow('on: [unclosed\n')).toBe(true);
    expect(isCheckWorkflow('- a list\n')).toBe(true);
  });
});

describe('reading whether a repository has CI', () => {
  test('nothing that produces checks and nothing required is no CI', async () => {
    const github = useFakeGitHub({
      workflows: { 'release.yml': 'on: workflow_dispatch\n', 'notes.md': 'on: push' },
    });
    expect(await readRepoCi(repo(), 'main')).toBe('none');
    const calls = github.calls().map((call) => call.join(' '));
    expect(calls.some((call) => call.includes('workflows=main:.github/workflows'))).toBe(true);
    expect(calls).toContain('api repos/acme/app/branches/main');
    expect(calls).toContain('api repos/acme/app/rules/branches/main');
  });

  test('a repository without a workflows folder has no CI', async () => {
    useFakeGitHub();
    expect(await readRepoCi(repo(), 'feat/base')).toBe('none');
  });

  test('a workflow on pull requests, or checks on the base commit, is CI to wait for', async () => {
    useFakeGitHub({ workflows: { 'test.yml': PULL_REQUEST_WORKFLOW } });
    expect(await readRepoCi(repo(), 'main')).toBe('workflows');
    useFakeGitHub({ baseChecks: true });
    expect(await readRepoCi(repo(), 'main')).toBe('workflows');
  });

  test('checks the base branch requires, by protection or by a ruleset, win', async () => {
    useFakeGitHub({ requiredChecks: ['test'], workflows: { 'test.yml': PULL_REQUEST_WORKFLOW } });
    expect(await readRepoCi(repo(), 'main')).toBe('required');
    useFakeGitHub({ rulesetChecks: ['lint'] });
    expect(await readRepoCi(repo(), 'main')).toBe('required');
  });

  test('a read GitHub refuses, or a repository not on GitHub, is unknown', async () => {
    useFakeGitHub();
    useBrokenGitHub('rules/branches');
    expect(await readRepoCi(repo(), 'main')).toBe('unknown');
    expect(await readRepoCi(createRepo({ path: createTempDir(), remote: null }), 'main')).toBe('unknown');
  });

  test('a workflows read GitHub refuses is unknown, but a required check still counts', async () => {
    useFakeGitHub({ requiredChecks: ['test'] });
    useBrokenGitHub('graphql');
    expect(await readRepoCi(repo(), 'main')).toBe('required');
    useFakeGitHub();
    expect(await readRepoCi(repo(), 'main')).toBe('unknown');
  });

  test('an answer that is not JSON is unknown', async () => {
    const dir = createTempDir();
    writeFileSync(join(dir, 'gh'), '#!/bin/sh\necho "not json"\n', { mode: 0o755 });
    restores.push(overrideEnv({ PATH: `${dir}:${process.env.PATH ?? ''}` }));
    expect(await readRepoCi(repo(), 'main')).toBe('unknown');
  });
});

describe('the cache', () => {
  test('reads a repository and base once', async () => {
    const github = useFakeGitHub({ workflows: { 'test.yml': PULL_REQUEST_WORKFLOW } });
    const cache = new RepoCiCache();
    const app = repo();
    expect(await cache.resolve(app, 'main')).toBe('workflows');
    expect(await cache.resolve(app, 'main')).toBe('workflows');
    expect(github.calls()).toHaveLength(3);
    expect(await cache.resolve(app, 'develop')).toBe('workflows');
    expect(github.calls()).toHaveLength(6);
  });

  test('a read stopped half way is not kept', async () => {
    useFakeGitHub();
    const cache = new RepoCiCache();
    const stopped = new AbortController();
    stopped.abort();
    const app = repo();
    expect(await cache.resolve(app, 'main', stopped.signal)).toBe('unknown');
    expect(await cache.resolve(app, 'main')).toBe('none');
  });
});
