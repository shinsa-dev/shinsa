import type { MergeQueueState, PullRequest, PullRequestCheckStatus, PullRequestRemark } from '@shinsa/core';
import { Schema } from 'effect';
import type { RefNameInvalid } from '../../git/schema.ts';
import type { GitHubAnswerInvalid, GitHubFailed } from '../schema.ts';

export const CheckEntry = Schema.Struct({
  status: Schema.optional(Schema.String),
  conclusion: Schema.optional(Schema.String),
  state: Schema.optional(Schema.String),
});
export type CheckEntry = typeof CheckEntry.Type;

export const PullRequestView = Schema.Struct({
  number: Schema.Number,
  url: Schema.String,
  state: Schema.Literals(['OPEN', 'MERGED', 'CLOSED']),
  mergeable: Schema.Literals(['MERGEABLE', 'CONFLICTING', 'UNKNOWN']),
  reviewDecision: Schema.NullOr(Schema.String),
  baseRefName: Schema.String,
  headRefOid: Schema.optional(Schema.NullOr(Schema.String)),
  mergeCommit: Schema.optional(Schema.NullOr(Schema.Struct({ oid: Schema.String }))),
  statusCheckRollup: Schema.NullOr(Schema.Array(CheckEntry)),
  additions: Schema.optional(Schema.Number),
  deletions: Schema.optional(Schema.Number),
  changedFiles: Schema.optional(Schema.Number),
});
export type PullRequestView = typeof PullRequestView.Type;

export const Login = Schema.Struct({ login: Schema.String, __typename: Schema.optional(Schema.String) });
export type Login = typeof Login.Type;

export const CommentNode = Schema.Struct({
  id: Schema.String,
  author: Schema.NullOr(Login),
  createdAt: Schema.String,
  lastEditedAt: Schema.NullOr(Schema.String),
  body: Schema.String,
  url: Schema.NullOr(Schema.String),
});
export type CommentNode = typeof CommentNode.Type;

export const ReviewNode = Schema.Struct({
  id: Schema.String,
  author: Schema.NullOr(Login),
  submittedAt: Schema.NullOr(Schema.String),
  lastEditedAt: Schema.NullOr(Schema.String),
  state: Schema.String,
  body: Schema.String,
  url: Schema.NullOr(Schema.String),
});
export type ReviewNode = typeof ReviewNode.Type;

const Comments = Schema.Struct({ totalCount: Schema.Number, nodes: Schema.Array(CommentNode) });

const ThreadNode = Schema.Struct({
  id: Schema.String,
  isResolved: Schema.Boolean,
  isOutdated: Schema.Boolean,
  path: Schema.NullOr(Schema.String),
  comments: Comments,
});

export const ContextNode = Schema.Struct({
  __typename: Schema.String,
  name: Schema.optional(Schema.String),
  context: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  conclusion: Schema.optional(Schema.NullOr(Schema.String)),
  state: Schema.optional(Schema.String),
  detailsUrl: Schema.optional(Schema.NullOr(Schema.String)),
  targetUrl: Schema.optional(Schema.NullOr(Schema.String)),
  isRequired: Schema.optional(Schema.Boolean),
});
export type ContextNode = typeof ContextNode.Type;

const CheckRollup = Schema.NullOr(
  Schema.Struct({ contexts: Schema.Struct({ nodes: Schema.Array(ContextNode) }) })
);

const BaseRef = Schema.Struct({
  target: Schema.NullOr(Schema.Struct({ statusCheckRollup: Schema.optional(CheckRollup) })),
});

export const PullRequestDetailsPull = Schema.Struct({
  author: Schema.NullOr(Login),
  mergeQueueEntry: Schema.NullOr(
    Schema.Struct({ state: Schema.String, position: Schema.NullOr(Schema.Number) })
  ),
  autoMergeRequest: Schema.NullOr(Schema.Struct({ enabledAt: Schema.String })),
  commits: Schema.Struct({
    nodes: Schema.Array(
      Schema.Struct({
        commit: Schema.Struct({
          statusCheckRollup: CheckRollup,
        }),
      })
    ),
  }),
  baseRef: Schema.optional(Schema.NullOr(BaseRef)),
  comments: Comments,
  reviews: Schema.Struct({ totalCount: Schema.Number, nodes: Schema.Array(ReviewNode) }),
  reviewThreads: Schema.Struct({ totalCount: Schema.Number, nodes: Schema.Array(ThreadNode) }),
  timelineItems: Schema.Struct({
    nodes: Schema.Array(Schema.Struct({ reason: Schema.optional(Schema.NullOr(Schema.String)) })),
  }),
});
export type PullRequestDetailsPull = typeof PullRequestDetailsPull.Type;

export const PullRequestDetails = Schema.Struct({
  viewer: Schema.NullOr(Login),
  repository: Schema.Struct({ pullRequest: PullRequestDetailsPull }),
});
export type PullRequestDetails = typeof PullRequestDetails.Type;

export const PullRequestBody = Schema.Struct({ body: Schema.optional(Schema.String) });

export const PullRequestTitle = Schema.Struct({ title: Schema.optional(Schema.String) });

export const AttachmentAnswer = Schema.Struct({ url: Schema.String });

export const RepositoryIdAnswer = Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0));

export interface PullRequestRead {
  readonly pullRequest: PullRequest;
  readonly remarks: PullRequestRemark[] | null;
  readonly viewer: string | null;
}

export interface Attachment {
  readonly path: string;
  readonly name: string;
  readonly contentType: string;
}

export class MergeMethodInvalid extends Schema.TaggedError<
  MergeMethodInvalid,
  { readonly brand: unique symbol }
>()('MergeMethodInvalid', { method: Schema.String, message: Schema.String }) {}

export class PullRequestBranchMissing extends Schema.TaggedError<
  PullRequestBranchMissing,
  { readonly brand: unique symbol }
>()('PullRequestBranchMissing', { message: Schema.String }) {}

export const FAILED = new Set([
  'FAILURE',
  'ERROR',
  'TIMED_OUT',
  'CANCELLED',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
]);

export const PENDING = new Set(['PENDING', 'QUEUED', 'IN_PROGRESS', 'WAITING', 'REQUESTED', 'EXPECTED']);

export const CHECK_STATUS: Record<string, PullRequestCheckStatus> = {
  SUCCESS: 'success',
  FAILURE: 'failure',
  ERROR: 'failure',
  TIMED_OUT: 'failure',
  STARTUP_FAILURE: 'failure',
  CANCELLED: 'cancelled',
  ACTION_REQUIRED: 'action_required',
  SKIPPED: 'skipped',
  NEUTRAL: 'neutral',
  STALE: 'neutral',
};

export const QUEUE_STATES = new Set<MergeQueueState>([
  'queued',
  'awaiting_checks',
  'mergeable',
  'unmergeable',
  'locked',
]);

export const MEANINGFUL_REVIEWS = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED']);

const COMMENT_FIELDS = 'totalCount nodes{id author{login __typename} createdAt lastEditedAt body url}';

export const DETAILS_QUERY = `query($owner:String!,$name:String!,$number:Int!){viewer{login} repository(owner:$owner,name:$name){pullRequest(number:$number){author{login} mergeQueueEntry{state position} autoMergeRequest{enabledAt} commits(last:1){nodes{commit{statusCheckRollup{contexts(first:100){nodes{__typename ... on CheckRun{name status conclusion detailsUrl isRequired(pullRequestNumber:$number)} ... on StatusContext{context state targetUrl isRequired(pullRequestNumber:$number)}}}}}}} baseRef{target{... on Commit{statusCheckRollup{contexts(first:100){nodes{__typename ... on CheckRun{name status conclusion} ... on StatusContext{context state}}}}}}} comments(last:100){${COMMENT_FIELDS}} reviews(last:100){totalCount nodes{id author{login __typename} submittedAt lastEditedAt state body url}} reviewThreads(first:100){totalCount nodes{id isResolved isOutdated path comments(last:50){${COMMENT_FIELDS}}}} timelineItems(last:1,itemTypes:[REMOVED_FROM_MERGE_QUEUE_EVENT]){nodes{... on RemovedFromMergeQueueEvent{reason}}}}}}`;

export const PULL_REQUEST_FIELDS =
  'number,url,state,mergeable,reviewDecision,baseRefName,headRefOid,mergeCommit,statusCheckRollup,additions,deletions,changedFiles';

export const NO_PULL_REQUEST_FOUND = /no pull requests found/i;

export const ATTACHMENT_UPLOAD_URL = 'https://uploads.github.com/user-attachments/assets';

export const ATTACHMENT_URL_PREFIX = 'https://github.com/user-attachments/';

export const NO_ATTACHMENT_ADDRESS = 'GitHub did not return an attachment address.';

export const COMMIT_SHA = /^[0-9a-f]{7,64}$/i;

export type GitHubError = GitHubFailed | GitHubAnswerInvalid;

export type PullRequestReadError = GitHubError | RefNameInvalid;
