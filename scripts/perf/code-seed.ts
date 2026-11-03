import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runGit } from '../kit/git/index.ts';

const SEED = Bun.argv[2] ?? '/tmp/shinsa-code-perf';
const PAYWALL = Bun.argv[3] ?? '';
const REPOS = join(SEED, 'repos');
const WORKTREES = join(SEED, 'data/worktrees');
const AUTHOR = {
  GIT_AUTHOR_NAME: 'Seed',
  GIT_AUTHOR_EMAIL: 'seed@example.com',
  GIT_COMMITTER_NAME: 'Seed',
  GIT_COMMITTER_EMAIL: 'seed@example.com',
};

function write(root: string, path: string, content: string | Uint8Array) {
  const file = join(root, path);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, content);
}

function seedPaywall(source: string) {
  const repo = join(REPOS, 'superwall/paywall-next');
  for (const dir of [repo, join(WORKTREES, 'task-embedded-chat'), join(WORKTREES, 'task-duplicate')])
    rmSync(dir, { recursive: true, force: true });
  for (const dir of ['task-mcp-rounds', 'task-tab-scroll'])
    rmSync(join(WORKTREES, dir), { recursive: true, force: true });
  runGit(['clone', '-q', '--local', '--no-hardlinks', source, repo], process.cwd(), { env: AUTHOR });
  const top = runGit(['rev-parse', 'HEAD'], repo, { env: AUTHOR });
  runGit(['remote', 'remove', 'origin'], repo, { env: AUTHOR });
  runGit(['checkout', '-q', '-B', 'main', `${top}~400`], repo, { env: AUTHOR });
  runGit(['branch', '-f', 'feat/embedded-chat-mcp', top], repo, { env: AUTHOR });
  runGit(['branch', '-f', 'fix/code-first-duplicate', `${top}~350`], repo, { env: AUTHOR });
  runGit(['worktree', 'add', '-q', join(WORKTREES, 'task-embedded-chat'), 'feat/embedded-chat-mcp'], repo, {
    env: AUTHOR,
  });
  runGit(['worktree', 'add', '-q', join(WORKTREES, 'task-duplicate'), 'fix/code-first-duplicate'], repo, {
    env: AUTHOR,
  });
}

function seedSynthetic() {
  const repo = join(REPOS, 'shinsa-sample');
  for (const dir of [repo, join(WORKTREES, 'task-sample-review'), join(WORKTREES, 'task-sample-theme')])
    rmSync(dir, { recursive: true, force: true });
  mkdirSync(repo, { recursive: true });
  runGit(['init', '-q', '-b', 'main'], repo, { env: AUTHOR });
  for (let pkg = 0; pkg < 100; pkg += 1) {
    for (let dir = 0; dir < 100; dir += 1) {
      const base = `pkg-${String(pkg).padStart(3, '0')}/dir-${String(dir).padStart(2, '0')}`;
      for (let file = 0; file < 10; file += 1)
        write(
          repo,
          `${base}/file-${file}.ts`,
          `export const value${pkg}_${dir}_${file} = ${pkg * 1000 + dir * 10 + file};\n`
        );
    }
  }
  write(
    repo,
    'big/lines.ts',
    Array.from({ length: 50_000 }, (_, line) => `export const line${line} = ${line};\n`).join('')
  );
  runGit(['add', '-A'], repo, { env: AUTHOR });
  runGit(['commit', '-q', '-m', 'chore: the base'], repo, { env: AUTHOR });
  runGit(['checkout', '-q', '-b', 'refactor/review-spots'], repo, { env: AUTHOR });
  for (let pkg = 0; pkg < 20; pkg += 1) {
    for (let dir = 0; dir < 100; dir += 1) {
      const path = `pkg-${String(pkg).padStart(3, '0')}/dir-${String(dir).padStart(2, '0')}/file-0.ts`;
      write(repo, path, `export const value = 1;\nexport const changed${pkg}_${dir} = true;\n`);
    }
  }
  write(
    repo,
    'big/huge.ts',
    Array.from({ length: 50_000 }, (_, line) => `export const added${line} = '${'x'.repeat(20)}';\n`).join('')
  );
  write(repo, 'big/blob.bin', crypto.getRandomValues(new Uint8Array(65_536)));
  runGit(['add', '-A'], repo, { env: AUTHOR });
  runGit(['commit', '-q', '-m', 'refactor: change many files'], repo, { env: AUTHOR });
  runGit(['checkout', '-q', 'main'], repo, { env: AUTHOR });
  runGit(['worktree', 'add', '-q', join(WORKTREES, 'task-sample-review'), 'refactor/review-spots'], repo, {
    env: AUTHOR,
  });
  runGit(['branch', '-f', 'feat/code-view-dark-theme', 'main'], repo, { env: AUTHOR });
  runGit(['worktree', 'add', '-q', join(WORKTREES, 'task-sample-theme'), 'feat/code-view-dark-theme'], repo, {
    env: AUTHOR,
  });
}

if (PAYWALL) seedPaywall(PAYWALL);
seedSynthetic();
console.log(`Seeded ${SEED}: serve it with SHINSA_DATA_DIR=${join(SEED, 'data')} SHINSA_INSPECT=1`);
