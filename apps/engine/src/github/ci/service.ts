import type { Repo, RepoCi } from '@shinsa/core';
import { Clock, Context, Duration, Effect, Layer, Option, Ref, type Schema } from 'effect';
import type { RepoSlug } from '../schema.ts';
import { GitHubCli } from '../service.ts';
import { resolveRepoSlug } from '../slug.ts';
import {
  BranchRules,
  BranchView,
  CI_QUERY,
  CiDetails,
  KNOWN_CI_TTL,
  UNKNOWN_CI_TTL,
  WORKFLOW_FILE,
} from './schema.ts';
import { isCheckWorkflow } from './workflows.ts';

export class RepoCiReader extends Context.Service<
  RepoCiReader,
  {
    read(repo: Repo, base: string, signal?: AbortSignal): Effect.Effect<RepoCi>;
    resolve(repo: Repo, base: string, signal?: AbortSignal): Effect.Effect<RepoCi>;
  }
>()('shinsa/engine/github/ci/RepoCiReader') {
  static readonly layer = Layer.effect(
    RepoCiReader,
    Effect.gen(function* () {
      const gh = yield* GitHubCli;
      const entries = yield* Ref.make(new Map<string, { ci: RepoCi; until: number }>());

      const readJson = <A>(
        schema: Schema.Decoder<A>,
        args: readonly string[],
        repo: Repo,
        signal?: AbortSignal
      ) => gh.json(schema, args, repo.path, { signal }).pipe(Effect.option, Effect.map(Option.getOrNull));

      const readCheckSources = Effect.fn('RepoCiReader.readCheckSources')(function* (
        repo: Repo,
        slug: RepoSlug,
        base: string,
        signal?: AbortSignal
      ) {
        const details = yield* readJson(
          CiDetails,
          [
            'api',
            'graphql',
            '-f',
            `query=${CI_QUERY}`,
            '-f',
            `owner=${slug.owner}`,
            '-f',
            `name=${slug.name}`,
            '-f',
            `workflows=${base}:.github/workflows`,
            '-f',
            `base=${base}`,
            '--jq',
            '.data',
          ],
          repo,
          signal
        );
        const repository = details?.repository;
        if (!repository) return null;
        const workflows = (repository.workflows?.entries ?? []).filter((entry) =>
          WORKFLOW_FILE.test(entry.name)
        );
        if (workflows.some((entry) => isCheckWorkflow(entry.object?.text ?? ''))) return true;
        return Boolean(repository.base?.statusCheckRollup);
      });

      const countRequiredChecks = Effect.fn('RepoCiReader.countRequiredChecks')(function* (
        repo: Repo,
        slug: RepoSlug,
        base: string,
        signal?: AbortSignal
      ) {
        const path = `repos/${slug.owner}/${slug.name}`;
        const branch = encodeURIComponent(base);
        const [view, rules] = yield* Effect.all(
          [
            readJson(BranchView, ['api', `${path}/branches/${branch}`], repo, signal),
            readJson(BranchRules, ['api', `${path}/rules/branches/${branch}`], repo, signal),
          ],
          { concurrency: 'unbounded' }
        );
        if (view === null || rules === null) return null;
        const required = view.protection?.required_status_checks;
        const protection = Math.max(required?.contexts?.length ?? 0, required?.checks?.length ?? 0);
        const ruled = rules
          .filter((rule) => rule.type === 'required_status_checks')
          .reduce((count, rule) => count + (rule.parameters?.required_status_checks?.length ?? 0), 0);
        return protection + ruled;
      });

      const read = Effect.fn('RepoCiReader.read')(function* (repo: Repo, base: string, signal?: AbortSignal) {
        const slug = resolveRepoSlug(repo);
        if (!slug) return 'unknown' as const;
        const [required, sources] = yield* Effect.all(
          [countRequiredChecks(repo, slug, base, signal), readCheckSources(repo, slug, base, signal)],
          { concurrency: 'unbounded' }
        );
        if (required !== null && required > 0) return 'required' as const;
        if (sources === true) return 'workflows' as const;
        if (required === null || sources === null) return 'unknown' as const;
        return 'none' as const;
      });

      const resolve = Effect.fn('RepoCiReader.resolve')(function* (
        repo: Repo,
        base: string,
        signal?: AbortSignal
      ) {
        const key = `${repo.id}\n${base}`;
        const cached = (yield* Ref.get(entries)).get(key);
        if (cached && cached.until > (yield* Clock.currentTimeMillis)) return cached.ci;
        const ci = yield* read(repo, base, signal);
        if (signal?.aborted) return ci;
        const ttl = ci === 'unknown' ? UNKNOWN_CI_TTL : KNOWN_CI_TTL;
        const until = (yield* Clock.currentTimeMillis) + Duration.toMillis(ttl);
        yield* Ref.update(entries, (known) => new Map(known).set(key, { ci, until }));
        return ci;
      });

      return RepoCiReader.of({ read, resolve });
    })
  );
}
