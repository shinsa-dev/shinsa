import { MERGE_METHODS, type Repo, replacePullRequestBlock, type Settings, type Task } from '@shinsa/core';
import { Clock, Context, Effect, Layer, Schema } from 'effect';
import { CommitInvalid } from '../../git/checkout/schema.ts';
import { decodeRefName } from '../../git/ref-name.ts';
import { GitHubAnswerInvalid, type GitHubFailed, NO_GITHUB_REMOTE, NoGitHubRemote } from '../schema.ts';
import { GitHubCli } from '../service.ts';
import { resolveRepoSlug } from '../slug.ts';
import {
  type Attachment,
  ATTACHMENT_UPLOAD_URL,
  ATTACHMENT_URL_PREFIX,
  AttachmentAnswer,
  COMMIT_SHA,
  DETAILS_QUERY,
  type GitHubError,
  MergeMethodInvalid,
  NO_ATTACHMENT_ADDRESS,
  NO_PULL_REQUEST,
  PULL_REQUEST_FIELDS,
  PullRequestBody,
  PullRequestBranchMissing,
  PullRequestDetails,
  type PullRequestRead,
  PullRequestTitle,
  type PullRequestReadError,
  PullRequestView,
  RepositoryIdAnswer,
} from './schema.ts';
import { resolveRemarks, serializePullRequest, serializePullRequestTitle } from './serialize.ts';

export class PullRequests extends Context.Service<
  PullRequests,
  {
    read(
      repo: Repo,
      task: Task,
      signal?: AbortSignal
    ): Effect.Effect<PullRequestRead | null, PullRequestReadError>;
    readStacked(
      repo: Repo,
      number: number,
      signal?: AbortSignal
    ): Effect.Effect<PullRequestRead | null, PullRequestReadError>;
    create(
      repo: Repo,
      task: Task,
      baseBranch: string | null,
      body: string,
      signal?: AbortSignal
    ): Effect.Effect<PullRequestRead | null, PullRequestReadError | PullRequestBranchMissing>;
    retarget(
      repo: Repo,
      number: number,
      base: string,
      signal?: AbortSignal
    ): Effect.Effect<void, PullRequestReadError>;
    close(
      repo: Repo,
      number: number,
      comment: string,
      signal?: AbortSignal
    ): Effect.Effect<void, GitHubFailed>;
    merge(
      repo: Repo,
      number: number,
      method: Settings['mergeMethod'],
      headSha: string | null,
      signal?: AbortSignal
    ): Effect.Effect<void, GitHubError | MergeMethodInvalid | CommitInvalid>;
    writeBlock(
      repo: Repo,
      number: number,
      block: string,
      signal?: AbortSignal
    ): Effect.Effect<boolean, GitHubError>;
    readDiff(repo: Repo, number: number, signal?: AbortSignal): Effect.Effect<string, GitHubFailed>;
    readFile(
      repo: Repo,
      ref: string,
      path: string,
      signal?: AbortSignal
    ): Effect.Effect<string, GitHubFailed | NoGitHubRemote>;
    repositoryId(repo: Repo, signal?: AbortSignal): Effect.Effect<number, GitHubError | NoGitHubRemote>;
    upload(
      repo: Repo,
      repositoryId: number,
      attachment: Attachment,
      signal?: AbortSignal
    ): Effect.Effect<string, GitHubError>;
  }
>()('shinsa/engine/github/pulls/PullRequests') {
  static readonly layer = Layer.effect(
    PullRequests,
    Effect.gen(function* () {
      const gh = yield* GitHubCli;
      const decodeRepositoryId = Schema.decodeUnknownEffect(RepositoryIdAnswer);

      const requireSlug = (repo: Repo) => {
        const slug = resolveRepoSlug(repo);
        return slug ? Effect.succeed(slug) : Effect.fail(new NoGitHubRemote({ message: NO_GITHUB_REMOTE }));
      };

      const readDetails = Effect.fn('PullRequests.readDetails')(function* (
        repo: Repo,
        number: number,
        signal?: AbortSignal
      ) {
        const slug = resolveRepoSlug(repo);
        if (!slug) {
          yield* Effect.logWarning(
            '[GitHub] The repository has no GitHub remote, so the pull request is read without its checks and threads'
          ).pipe(Effect.annotateLogs({ repo: repo.name, number }));
          return null;
        }
        return yield* gh.json(
          PullRequestDetails,
          [
            'api',
            'graphql',
            '-f',
            `query=${DETAILS_QUERY}`,
            '-f',
            `owner=${slug.owner}`,
            '-f',
            `name=${slug.name}`,
            '-F',
            `number=${number}`,
            '--jq',
            '.data',
          ],
          repo.path,
          { signal }
        );
      });

      const readView = Effect.fn('PullRequests.readView')(function* (
        repo: Repo,
        target: string,
        signal?: AbortSignal
      ) {
        const ref = yield* decodeRefName(target);
        return yield* gh
          .json(PullRequestView, ['pr', 'view', ref, '--json', PULL_REQUEST_FIELDS], repo.path, { signal })
          .pipe(
            Effect.catchTag('GitHubFailed', (failed) =>
              NO_PULL_REQUEST.test(failed.message) ? Effect.succeed(null) : Effect.fail(failed)
            )
          );
      });

      const readTarget = Effect.fn('PullRequests.readTarget')(function* (
        repo: Repo,
        target: string,
        signal?: AbortSignal
      ) {
        const view = yield* readView(repo, target, signal);
        if (!view) return null;
        const details = yield* readDetails(repo, view.number, signal);
        return {
          pullRequest: serializePullRequest(view, details, yield* Clock.currentTimeMillis),
          remarks: details ? resolveRemarks(details) : null,
          viewer: details?.viewer?.login ?? details?.repository.pullRequest.author?.login ?? null,
        } satisfies PullRequestRead;
      });

      const read = (repo: Repo, task: Task, signal?: AbortSignal) => {
        const target = task.pullRequest ? String(task.pullRequest.number) : task.branch;
        return target ? readTarget(repo, target, signal) : Effect.succeed(null);
      };

      const readStacked = (repo: Repo, number: number, signal?: AbortSignal) =>
        readTarget(repo, String(number), signal);

      const create = Effect.fn('PullRequests.create')(function* (
        repo: Repo,
        task: Task,
        baseBranch: string | null,
        body: string,
        signal?: AbortSignal
      ) {
        if (!task.branch || !task.worktreePath) {
          return yield* new PullRequestBranchMissing({
            message: 'The task has no branch to open a pull request from.',
          });
        }
        const existing = yield* read(repo, task, signal);
        if (existing?.pullRequest.state === 'open') return existing;
        const head = yield* decodeRefName(task.branch);
        const base = yield* decodeRefName(baseBranch ?? repo.defaultBranch);
        yield* gh.run(
          [
            'pr',
            'create',
            '--head',
            head,
            '--base',
            base,
            '--title',
            serializePullRequestTitle(task),
            '--body-file',
            '-',
          ],
          task.worktreePath,
          { input: body, signal }
        );
        return yield* read(repo, task, signal);
      });

      const retarget = Effect.fn('PullRequests.retarget')(function* (
        repo: Repo,
        number: number,
        base: string,
        signal?: AbortSignal
      ) {
        const ref = yield* decodeRefName(base);
        yield* gh.run(['pr', 'edit', String(number), '--base', ref], repo.path, { signal });
      });

      const close = Effect.fn('PullRequests.close')(function* (
        repo: Repo,
        number: number,
        comment: string,
        signal?: AbortSignal
      ) {
        yield* gh.run(['pr', 'close', String(number), '--comment', comment], repo.path, { signal });
      });

      const resolveMergeMessage = Effect.fn('PullRequests.resolveMergeMessage')(function* (
        repo: Repo,
        number: number,
        method: Settings['mergeMethod'],
        signal?: AbortSignal
      ) {
        if (method === 'rebase') return [];
        const view = yield* gh.json(
          PullRequestTitle,
          ['pr', 'view', String(number), '--json', 'title'],
          repo.path,
          {
            signal,
          }
        );
        const title = view.title?.trim();
        return title ? ['--subject', `${title} (#${number})`, '--body', ''] : [];
      });

      const merge = Effect.fn('PullRequests.merge')(function* (
        repo: Repo,
        number: number,
        method: Settings['mergeMethod'],
        headSha: string | null,
        signal?: AbortSignal
      ) {
        if (!MERGE_METHODS.has(method)) {
          return yield* new MergeMethodInvalid({ method, message: `"${method}" is not a merge method.` });
        }
        if (headSha !== null && !COMMIT_SHA.test(headSha)) {
          return yield* new CommitInvalid({ commit: headSha, message: `"${headSha}" is not a commit.` });
        }
        const guard = headSha ? ['--match-head-commit', headSha] : [];
        const message = yield* resolveMergeMessage(repo, number, method, signal);
        yield* gh.run(['pr', 'merge', String(number), `--${method}`, ...guard, ...message], repo.path, {
          signal,
        });
      });

      const writeBlock = Effect.fn('PullRequests.writeBlock')(function* (
        repo: Repo,
        number: number,
        block: string,
        signal?: AbortSignal
      ) {
        const view = yield* gh.json(
          PullRequestBody,
          ['pr', 'view', String(number), '--json', 'body'],
          repo.path,
          {
            signal,
          }
        );
        const current = view.body ?? '';
        const body = replacePullRequestBlock(current, block);
        if (body === current) return false;
        yield* gh.run(['pr', 'edit', String(number), '--body-file', '-'], repo.path, { input: body, signal });
        return true;
      });

      const readDiff = (repo: Repo, number: number, signal?: AbortSignal) =>
        gh.run(['pr', 'diff', String(number)], repo.path, { signal });

      const readFile = Effect.fn('PullRequests.readFile')(function* (
        repo: Repo,
        ref: string,
        path: string,
        signal?: AbortSignal
      ) {
        const slug = yield* requireSlug(repo);
        const file = path.split('/').map(encodeURIComponent).join('/');
        const output = yield* gh.run(
          [
            'api',
            `repos/${slug.owner}/${slug.name}/contents/${file}?ref=${encodeURIComponent(ref)}`,
            '--jq',
            '.content',
          ],
          repo.path,
          { signal }
        );
        return Buffer.from(output.replace(/\s/g, ''), 'base64').toString('utf8');
      });

      const repositoryId = Effect.fn('PullRequests.repositoryId')(function* (
        repo: Repo,
        signal?: AbortSignal
      ) {
        const slug = yield* requireSlug(repo);
        const output = yield* gh.run(['api', `repos/${slug.owner}/${slug.name}`, '--jq', '.id'], repo.path, {
          signal,
        });
        return yield* decodeRepositoryId(Number(output.trim())).pipe(
          Effect.mapError(
            () =>
              new GitHubAnswerInvalid({ message: `GitHub returned "${output.trim()}" as the repository id.` })
          )
        );
      });

      const upload = Effect.fn('PullRequests.upload')(function* (
        repo: Repo,
        id: number,
        attachment: Attachment,
        signal?: AbortSignal
      ) {
        const query = new URLSearchParams({
          name: attachment.name,
          content_type: attachment.contentType,
          repository_id: String(id),
        });
        const reply = yield* gh
          .json(
            AttachmentAnswer,
            [
              'api',
              `${ATTACHMENT_UPLOAD_URL}?${query}`,
              '--method',
              'POST',
              '--input',
              attachment.path,
              '-H',
              `Content-Type: ${attachment.contentType}`,
              '-H',
              'Accept: application/json',
            ],
            repo.path,
            { signal }
          )
          .pipe(
            Effect.catchTag('GitHubAnswerInvalid', () =>
              Effect.fail(new GitHubAnswerInvalid({ message: NO_ATTACHMENT_ADDRESS }))
            )
          );
        if (!reply.url.startsWith(ATTACHMENT_URL_PREFIX)) {
          return yield* new GitHubAnswerInvalid({ message: NO_ATTACHMENT_ADDRESS });
        }
        return reply.url;
      });

      return PullRequests.of({
        read,
        readStacked,
        create,
        retarget,
        close,
        merge,
        writeBlock,
        readDiff,
        readFile,
        repositoryId,
        upload,
      });
    })
  );
}
