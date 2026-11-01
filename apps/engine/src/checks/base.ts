import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { Repo } from '@shinsa/core';
import { slugify } from '../git/refs.ts';
import { runGitOrThrow } from '../git/run.ts';
import { prepareWorktree } from '../git/worktree.ts';
import { describeError, log } from '../log/index.ts';
import { runCommand } from '../shell/index.ts';
import { type CheckFailure, type FailureDiff, listCheckFailures, resolveFailureDiff } from './failures.ts';
import { type CheckOptions, type CheckRun, runCheckCommand } from './index.ts';

const KEPT_CHECKOUTS = 3;

const COMMIT = /^[0-9a-f]{7,64}$/;

export interface BaseRequest extends CheckOptions {
  repo: Repo;
  resolveBase: () => Promise<string | null>;
  cwd: string;
  run: CheckRun;
}

interface BaseResult {
  failed: boolean;
  failures: CheckFailure[] | null;
}

interface Checkout {
  key: string;
  repo: Repo;
  path: string;
  ready: Promise<string>;
  users: number;
}

function listCommandPaths(command: string, cwd: string) {
  return command
    .split(/\s+/)
    .map((token) => token.replace(/^['"]|['"]$/g, ''))
    .map((token) => (token.startsWith('-') ? (token.split('=')[1] ?? '') : token))
    .map((token) => token.replace(/^\.\//, ''))
    .filter((token) => token.length > 0 && !isAbsolute(token) && existsSync(join(cwd, token)));
}

export class BaseCheckouts {
  readonly #dir: string;
  readonly #keep: number;
  readonly #checkouts = new Map<string, Checkout>();
  readonly #results = new Map<string, Promise<BaseResult | null>>();

  constructor(dir: string, keep = KEPT_CHECKOUTS) {
    this.#dir = dir;
    this.#keep = keep;
  }

  async compareWithBase(request: BaseRequest): Promise<FailureDiff | null> {
    const { repo, run } = request;
    let checkout: Checkout | null = null;
    try {
      if (!run.failures) return null;
      const base = await request.resolveBase();
      if (!base || !COMMIT.test(base)) return null;
      checkout = this.#acquire(repo, base, request.signal);
      const path = await checkout.ready;
      const needed = [...(run.failedFiles ?? []), ...listCommandPaths(run.check.command, request.cwd)];
      if (needed.some((file) => !existsSync(join(path, file)))) return null;
      const result = await this.#runOnBase(checkout, path, request);
      if (!result?.failed || !result.failures) return null;
      return resolveFailureDiff(run.failures, result.failures);
    } catch (error) {
      log.warn('[Checks] Could not run a check on the base commit', {
        repoId: repo.id,
        command: run.check.command,
        error: describeError(error),
      });
      return null;
    } finally {
      if (checkout) checkout.users -= 1;
    }
  }

  #runOnBase(checkout: Checkout, path: string, request: BaseRequest) {
    const key = `${checkout.key}\n${request.run.check.command}`;
    const known = this.#results.get(key);
    if (known) return known;
    const pending = this.#runCommand(path, request).then((result) => {
      if (!result) this.#results.delete(key);
      return result;
    });
    this.#results.set(key, pending);
    return pending;
  }

  async #runCommand(path: string, request: BaseRequest): Promise<BaseResult | null> {
    const { signal, timeoutMs, env } = request;
    const result = await runCheckCommand(['sh', '-c', request.run.check.command], path, {
      timeoutMs,
      signal,
      ...(env ? { env } : {}),
    });
    if (signal?.aborted || result.timedOut) return null;
    if (result.ok) return { failed: false, failures: [] };
    return { failed: true, failures: listCheckFailures(`${result.stdout}\n${result.stderr}`, path) };
  }

  #acquire(repo: Repo, base: string, signal?: AbortSignal) {
    const key = `${repo.id}\n${base}`;
    const known = this.#checkouts.get(key);
    if (known) {
      this.#checkouts.delete(key);
      this.#checkouts.set(key, known);
      known.users += 1;
      return known;
    }
    const path = join(this.#dir, `${slugify(repo.id, 40)}-${base.slice(0, 12)}`);
    const checkout: Checkout = { key, repo, path, ready: Promise.resolve(path), users: 1 };
    this.#checkouts.set(key, checkout);
    checkout.ready = this.#evict().then(() => this.#create(repo, base, path, signal));
    checkout.ready.catch(() => this.#checkouts.delete(key));
    return checkout;
  }

  async #create(repo: Repo, base: string, path: string, signal?: AbortSignal) {
    mkdirSync(this.#dir, { recursive: true });
    rmSync(path, { recursive: true, force: true });
    await runCommand(['git', 'worktree', 'prune'], repo.path, { signal });
    await runGitOrThrow(['worktree', 'add', '--detach', path, base], repo.path, { signal });
    await prepareWorktree(path, signal);
    return path;
  }

  async #evict() {
    const kept = new Set([...this.#checkouts.values()].map((checkout) => checkout.path));
    for (const name of existsSync(this.#dir) ? readdirSync(this.#dir) : []) {
      const path = join(this.#dir, name);
      if (!(kept.has(path) || name.startsWith('.'))) rmSync(path, { recursive: true, force: true });
    }
    const idle = [...this.#checkouts.values()].filter((checkout) => checkout.users === 0);
    const extra = this.#checkouts.size - this.#keep;
    for (const checkout of idle.slice(0, Math.max(0, extra))) await this.#remove(checkout);
  }

  async #remove(checkout: Checkout) {
    this.#checkouts.delete(checkout.key);
    for (const key of this.#results.keys()) {
      if (key.startsWith(`${checkout.key}\n`)) this.#results.delete(key);
    }
    await runCommand(['git', 'worktree', 'remove', '--force', checkout.path], checkout.repo.path);
    rmSync(checkout.path, { recursive: true, force: true });
  }
}
