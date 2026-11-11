import { Context, Effect, Layer, Option } from 'effect';
import { decodeRefName } from '../../git/ref-name.ts';
import { describeShortFailure, normalizeRemote } from '../../git/remote/output.ts';
import { Remote } from '../../git/remote/service.ts';
import { Git } from '../../git/service.ts';
import { resolveGitTokenEnv } from '../../github/identity/resolve.ts';
import { TaskGitHub } from '../../github/identity/schema.ts';
import { GitHubCli } from '../../github/service.ts';
import { describeFailure } from '../../shell/failure.ts';
import {
  GitHubRepository,
  MISSING_REPOSITORY,
  ORIGIN_PUSH_TIMEOUT,
  OriginNotConnected,
  type OriginTarget,
  REPOSITORY_FIELDS,
  UNKNOWN_OWNER,
} from './schema.ts';

export class RepoOrigins extends Context.Service<
  RepoOrigins,
  {
    connect(
      target: OriginTarget,
      preferredOwners: readonly string[],
      signal?: AbortSignal
    ): Effect.Effect<string, OriginNotConnected>;
  }
>()('shinsa/engine/repos/origin/RepoOrigins') {
  static readonly layer = Layer.effect(
    RepoOrigins,
    Effect.gen(function* () {
      const git = yield* Git;
      const gh = yield* GitHubCli;
      const remotes = yield* Remote;

      const listOwners = (groups: readonly (readonly string[])[]) => {
        const seen = new Set<string>();
        return groups.flat().flatMap((owner) => {
          const key = owner.trim().toLowerCase();
          if (!key || seen.has(key)) return [];
          seen.add(key);
          return [key];
        });
      };

      const describeReason = (text: string) => describeShortFailure(text).replace(/\.$/, '');

      const listLines = (text: string) =>
        text
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0);

      const refuse = (target: OriginTarget, owner: string, branch: string, reason: string) =>
        new OriginNotConnected({
          path: target.path,
          message: `${reason} Connect it yourself with \`git -C ${target.path} remote add origin https://github.com/${owner}/${target.name}.git && git -C ${target.path} push -u origin ${branch}\`, then try again.`,
        });

      const listCandidateOwners = Effect.fn('RepoOrigins.listCandidateOwners')(function* (
        target: OriginTarget,
        preferred: readonly string[],
        branch: string
      ) {
        const login = yield* gh.attempt(['api', 'user', '--jq', '.login'], target.path);
        if (!login.ok)
          return yield* refuse(
            target,
            preferred[0] ?? UNKNOWN_OWNER,
            branch,
            `gh could not tell which GitHub account to use: ${describeReason(login.stderr)}.`
          );
        const orgs = yield* gh.attempt(['api', 'user/orgs', '--jq', '.[].login'], target.path);
        if (!orgs.ok)
          return yield* refuse(
            target,
            preferred[0] ?? login.stdout,
            branch,
            `gh could not list your GitHub organizations: ${describeReason(orgs.stderr)}.`
          );
        return listOwners([preferred, [login.stdout], listLines(orgs.stdout)]);
      });

      const selectRepository = Effect.fn('RepoOrigins.selectRepository')(function* (
        target: OriginTarget,
        owner: string,
        branch: string
      ) {
        const slug = `${owner}/${target.name}`;
        return yield* gh
          .json(GitHubRepository, ['repo', 'view', slug, '--json', REPOSITORY_FIELDS], target.path)
          .pipe(
            Effect.map(Option.some),
            Effect.catch((failure) =>
              MISSING_REPOSITORY.test(failure.message)
                ? Effect.succeed(Option.none<GitHubRepository>())
                : Effect.fail(
                    refuse(
                      target,
                      owner,
                      branch,
                      `gh could not check for github.com/${slug}: ${describeReason(failure.message)}.`
                    )
                  )
            )
          );
      });

      const findOrCreateRepository = Effect.fn('RepoOrigins.findOrCreateRepository')(function* (
        target: OriginTarget,
        owners: readonly string[],
        branch: string
      ) {
        for (const owner of owners) {
          const found = yield* selectRepository(target, owner, branch);
          if (Option.isNone(found)) continue;
          if (found.value.isEmpty) return { owner, repository: found.value };
          return yield* refuse(
            target,
            owner,
            branch,
            `github.com/${owner}/${target.name} already has commits, so I did not connect it to ${target.path}.`
          );
        }
        const owner = owners[0] ?? UNKNOWN_OWNER;
        const slug = `${owner}/${target.name}`;
        const created = yield* gh.attempt(['repo', 'create', slug, '--private'], target.path);
        if (!created.ok)
          return yield* refuse(
            target,
            owner,
            branch,
            `gh could not create github.com/${slug}: ${describeReason(describeFailure(['gh', 'repo', 'create'], created))}.`
          );
        const made = yield* selectRepository(target, owner, branch);
        if (Option.isSome(made)) return { owner, repository: made.value };
        return yield* refuse(
          target,
          owner,
          branch,
          `gh created github.com/${slug}, but it could not be read back.`
        );
      });

      const resolveCloneUrl = Effect.fn('RepoOrigins.resolveCloneUrl')(function* (
        target: OriginTarget,
        repository: GitHubRepository
      ) {
        const protocol = yield* gh.attempt(['config', 'get', 'git_protocol'], target.path);
        return protocol.ok && protocol.stdout === 'ssh' ? repository.sshUrl : repository.url;
      });

      const pushDefaultBranch = Effect.fn('RepoOrigins.pushDefaultBranch')(function* (
        target: OriginTarget,
        url: string,
        owner: string,
        branch: string,
        signal?: AbortSignal
      ) {
        const added = yield* git.attempt(['remote', 'add', 'origin', url], target.path);
        if (!added.ok)
          return yield* refuse(
            target,
            owner,
            branch,
            `git could not add origin: ${describeReason(describeFailure(['git', 'remote', 'add'], added))}.`
          );
        const args = ['push', '--quiet', '-u', 'origin', `refs/heads/${branch}:refs/heads/${branch}`];
        const env = resolveGitTokenEnv((yield* TaskGitHub).identity);
        const pushed = yield* git.attempt(args, target.path, { timeout: ORIGIN_PUSH_TIMEOUT, signal, env });
        if (pushed.ok) return;
        yield* git.attempt(['remote', 'remove', 'origin'], target.path);
        return yield* refuse(
          target,
          owner,
          branch,
          `git could not push “${branch}” to ${normalizeRemote(url)}: ${describeReason(describeFailure(['git', ...args], pushed))}.`
        );
      });

      const connect = Effect.fn('RepoOrigins.connect')(function* (
        target: OriginTarget,
        preferredOwners: readonly string[],
        signal?: AbortSignal
      ) {
        const existing = yield* remotes.resolveOrigin(target.path);
        if (existing) return existing;
        const branch = yield* decodeRefName(target.defaultBranch).pipe(
          Effect.mapError(
            (invalid) => new OriginNotConnected({ path: target.path, message: invalid.message })
          )
        );
        const owners = yield* listCandidateOwners(target, preferredOwners, branch);
        const { owner, repository } = yield* findOrCreateRepository(target, owners, branch);
        const url = yield* resolveCloneUrl(target, repository);
        yield* pushDefaultBranch(target, url, owner, branch, signal);
        yield* Effect.logInfo('connected the repository to GitHub').pipe(
          Effect.annotateLogs({ path: target.path, remote: normalizeRemote(url) })
        );
        return normalizeRemote(url);
      });

      return RepoOrigins.of({ connect });
    })
  );
}
