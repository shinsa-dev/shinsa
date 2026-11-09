import { isAbsolute, join } from 'node:path';
import type { Repo } from '@shinsa/core';
import { Cause, Context, Effect, FileSystem, Layer, Option } from 'effect';
import { constFalse } from 'effect/Function';
import { EngineConfig } from '../../config/service.ts';
import { COMMIT_ID } from '../../git/checkout/schema.ts';
import { Checkout } from '../../git/checkout/service.ts';
import { slugify } from '../../git/refs.ts';
import { Git } from '../../git/service.ts';
import { describeError } from '../../log/redact.ts';
import { resolveFailureDiff, selectCheckFailures } from '../failures.ts';
import { CheckRunner } from '../runner/service.ts';
import {
  type BaseCheckout,
  type BaseRequest,
  type BaseResult,
  type FailureDiff,
  KeptCheckouts,
} from '../schema.ts';

export class BaseCheckouts extends Context.Service<
  BaseCheckouts,
  { compare(request: BaseRequest): Effect.Effect<FailureDiff | null> }
>()('shinsa/engine/checks/base/BaseCheckouts') {
  static readonly layer = Layer.effect(
    BaseCheckouts,
    Effect.gen(function* () {
      const git = yield* Git;
      const checkout = yield* Checkout;
      const runner = yield* CheckRunner;
      const dir = (yield* EngineConfig).checkBasesDir;
      const keep = yield* KeptCheckouts;
      const fs = yield* FileSystem.FileSystem;
      const withFiles = Effect.provideService(FileSystem.FileSystem, fs);
      const isPresent = (path: string) => fs.exists(path).pipe(Effect.orElseSucceed(constFalse));
      const removeFolder = (path: string) => fs.remove(path, { recursive: true, force: true });
      const checkouts = new Map<string, BaseCheckout>();
      const results = new Map<string, Effect.Effect<BaseResult | null>>();

      const listCommandTokens = (command: string) =>
        command
          .split(/\s+/)
          .map((token) => token.replace(/^['"]|['"]$/g, ''))
          .map((token) => (token.startsWith('-') ? (token.split('=')[1] ?? '') : token))
          .map((token) => token.replace(/^\.\//, ''))
          .filter((token) => token.length > 0 && !isAbsolute(token));

      const remove = Effect.fn('BaseCheckouts.remove')(function* (held: BaseCheckout) {
        checkouts.delete(held.key);
        for (const key of results.keys()) {
          if (key.startsWith(`${held.key}\n`)) results.delete(key);
        }
        yield* git.attempt(['worktree', 'remove', '--force', held.path], held.repo.path);
        yield* removeFolder(held.path);
      });

      const evict = Effect.fn('BaseCheckouts.evict')(function* () {
        const kept = new Set([...checkouts.values()].map((held) => held.path));
        const names = (yield* isPresent(dir)) ? yield* fs.readDirectory(dir) : [];
        for (const name of names) {
          const path = join(dir, name);
          if (!(kept.has(path) || name.startsWith('.'))) yield* removeFolder(path);
        }
        const idle = [...checkouts.values()].filter((held) => held.users === 0);
        const extra = checkouts.size - keep;
        for (const held of idle.slice(0, Math.max(0, extra))) yield* remove(held);
      });

      const create = Effect.fn('BaseCheckouts.create')(function* (
        repo: Repo,
        base: string,
        path: string,
        signal?: AbortSignal
      ) {
        yield* fs.makeDirectory(dir, { recursive: true });
        yield* removeFolder(path);
        yield* git.attempt(['worktree', 'prune'], repo.path, { signal });
        yield* git.run(['worktree', 'add', '--detach', path, base], repo.path, { signal });
        yield* checkout.prepare(path, signal);
        return path;
      });

      const acquire = Effect.fn('BaseCheckouts.acquire')(function* (
        repo: Repo,
        base: string,
        signal?: AbortSignal
      ) {
        const key = `${repo.id}\n${base}`;
        const known = checkouts.get(key);
        if (known) {
          checkouts.delete(key);
          checkouts.set(key, known);
          known.users += 1;
          return known;
        }
        const path = join(dir, `${slugify(repo.id, 40)}-${base.slice(0, 12)}`);
        const held: BaseCheckout = { key, repo, path, ready: Effect.succeed(path), users: 1 };
        checkouts.set(key, held);
        held.ready = yield* Effect.cached(
          evict().pipe(
            Effect.andThen(create(repo, base, path, signal)),
            Effect.tapCause(() => Effect.sync(() => checkouts.delete(key)))
          )
        );
        return held;
      });

      const runCommand = Effect.fn('BaseCheckouts.runCommand')(function* (
        path: string,
        request: BaseRequest
      ) {
        const { signal, timeoutMs, env } = request;
        const result = yield* runner.command(['sh', '-c', request.run.check.command], path, {
          timeoutMs,
          ...(signal ? { signal } : {}),
          ...(env ? { env } : {}),
        });
        if (signal?.aborted || result.timedOut) return null;
        if (result.ok) return { failed: false, failures: [] } satisfies BaseResult;
        const failures = yield* withFiles(selectCheckFailures(`${result.stdout}\n${result.stderr}`, path));
        return { failed: true, failures: Option.getOrNull(failures) } satisfies BaseResult;
      });

      const runOnBase = Effect.fn('BaseCheckouts.runOnBase')(function* (
        held: BaseCheckout,
        path: string,
        request: BaseRequest
      ) {
        const key = `${held.key}\n${request.run.check.command}`;
        const known = results.get(key);
        if (known) return yield* known;
        const pending = yield* Effect.cached(
          runCommand(path, request).pipe(
            Effect.tap((result) => Effect.sync(() => (result ? undefined : results.delete(key))))
          )
        );
        results.set(key, pending);
        return yield* pending;
      });

      const compareHeld = Effect.fn('BaseCheckouts.compareHeld')(function* (
        request: BaseRequest,
        release: (held: BaseCheckout) => void
      ) {
        const { repo, run } = request;
        if (!run.failures) return null;
        const base = yield* request.resolveBase;
        if (!base || !COMMIT_ID.test(base)) return null;
        const held = yield* acquire(repo, base, request.signal);
        return yield* Effect.gen(function* () {
          const path = yield* held.ready;
          const commandPaths = yield* Effect.filter(listCommandTokens(run.check.command), (token) =>
            isPresent(join(request.cwd, token))
          );
          for (const file of [...(run.failedFiles ?? []), ...commandPaths]) {
            if (!(yield* isPresent(join(path, file)))) return null;
          }
          const result = yield* runOnBase(held, path, request);
          if (!result?.failed || !result.failures) return null;
          return resolveFailureDiff(run.failures ?? [], result.failures);
        }).pipe(Effect.ensuring(Effect.sync(() => release(held))));
      });

      const compare = Effect.fn('BaseCheckouts.compare')(function* (request: BaseRequest) {
        return yield* compareHeld(request, (held) => {
          held.users -= 1;
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.as(
              Effect.logWarning('[Checks] Could not run a check on the base commit').pipe(
                Effect.annotateLogs({
                  repoId: request.repo.id,
                  command: request.run.check.command,
                  error: describeError(Cause.squash(cause)),
                })
              ),
              null
            )
          )
        );
      });

      return BaseCheckouts.of({ compare });
    })
  );
}
