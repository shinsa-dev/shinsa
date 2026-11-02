import { Effect } from 'effect';
import { edgeRuntime } from '../runtime/edge.ts';
import { FeedbackIssues } from './issues/service.ts';
import type { FeedbackFiling, FeedbackIssueInput, FeedbackListing } from './schema.ts';

export { parseIssueStates, parseIssueUrl, serializeFeedbackBody } from './answers.ts';
export type { FeedbackFiling, FeedbackIssueInput } from './schema.ts';

export function fileFeedbackIssue(
  input: FeedbackIssueInput,
  cwd: string,
  signal?: AbortSignal
): Promise<FeedbackFiling> {
  return edgeRuntime.runPromise(
    FeedbackIssues.use((issues) => issues.file(input, cwd, signal)).pipe(
      Effect.match({
        onFailure: (error): FeedbackFiling => ({ ok: false, detail: error.message }),
        onSuccess: (issue): FeedbackFiling => ({ ok: true, issue }),
      })
    )
  );
}

export function listFeedbackIssueStates(cwd: string, signal?: AbortSignal): Promise<FeedbackListing> {
  return edgeRuntime.runPromise(
    FeedbackIssues.use((issues) => issues.listStates(cwd, signal)).pipe(
      Effect.match({
        onFailure: (error): FeedbackListing => ({ ok: false, detail: error.message }),
        onSuccess: (states): FeedbackListing => ({ ok: true, states }),
      })
    )
  );
}
