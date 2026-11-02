import type { Repo, Settings, Task } from '@shinsa/core';
import { edgeRuntime } from '../runtime/edge.ts';
import type { Attachment } from './pulls/schema.ts';
import { PullRequests } from './pulls/service.ts';

export type { Attachment, PullRequestDetails, PullRequestRead } from './pulls/schema.ts';
export {
  resolveCheckRuns,
  resolveCheckRunsState,
  resolveChecks,
  resolveRemarks,
  serializePullRequest,
  serializePullRequestTitle,
} from './pulls/serialize.ts';
export { resolveRepoSlug } from './slug.ts';

export function readPullRequest(repo: Repo, task: Task, signal?: AbortSignal) {
  return edgeRuntime.runPromise(PullRequests.use((pulls) => pulls.read(repo, task, signal)));
}

export function readStackedPullRequest(repo: Repo, number: number, signal?: AbortSignal) {
  return edgeRuntime.runPromise(PullRequests.use((pulls) => pulls.readStacked(repo, number, signal)));
}

export function resolveRepositoryId(repo: Repo, signal?: AbortSignal) {
  return edgeRuntime.runPromise(PullRequests.use((pulls) => pulls.repositoryId(repo, signal)));
}

export function readRepoFile(repo: Repo, ref: string, path: string, signal?: AbortSignal) {
  return edgeRuntime.runPromise(PullRequests.use((pulls) => pulls.readFile(repo, ref, path, signal)));
}

export function readPullRequestDiff(repo: Repo, number: number, signal?: AbortSignal) {
  return edgeRuntime.runPromise(PullRequests.use((pulls) => pulls.readDiff(repo, number, signal)));
}

export function uploadAttachment(
  repo: Repo,
  repositoryId: number,
  attachment: Attachment,
  signal?: AbortSignal
) {
  return edgeRuntime.runPromise(
    PullRequests.use((pulls) => pulls.upload(repo, repositoryId, attachment, signal))
  );
}

export function writePullRequestBlock(repo: Repo, number: number, block: string, signal?: AbortSignal) {
  return edgeRuntime.runPromise(PullRequests.use((pulls) => pulls.writeBlock(repo, number, block, signal)));
}

export function createPullRequest(
  repo: Repo,
  task: Task,
  baseBranch: string | null,
  body: string,
  signal?: AbortSignal
) {
  return edgeRuntime.runPromise(
    PullRequests.use((pulls) => pulls.create(repo, task, baseBranch, body, signal))
  );
}

export function retargetPullRequest(repo: Repo, number: number, base: string, signal?: AbortSignal) {
  return edgeRuntime.runPromise(PullRequests.use((pulls) => pulls.retarget(repo, number, base, signal)));
}

export function closePullRequest(repo: Repo, number: number, comment: string, signal?: AbortSignal) {
  return edgeRuntime.runPromise(PullRequests.use((pulls) => pulls.close(repo, number, comment, signal)));
}

export function mergePullRequest(
  repo: Repo,
  number: number,
  method: Settings['mergeMethod'],
  headSha: string | null,
  signal?: AbortSignal
) {
  return edgeRuntime.runPromise(
    PullRequests.use((pulls) => pulls.merge(repo, number, method, headSha, signal))
  );
}
