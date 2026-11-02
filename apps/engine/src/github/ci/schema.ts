import type { Repo, RepoCi } from '@shinsa/core';
import { Duration, type Effect, Schema } from 'effect';

const WorkflowEntry = Schema.Struct({
  name: Schema.String,
  object: Schema.NullOr(Schema.Struct({ text: Schema.optional(Schema.NullOr(Schema.String)) })),
});

export const CiDetails = Schema.Struct({
  repository: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        workflows: Schema.optional(
          Schema.NullOr(Schema.Struct({ entries: Schema.optional(Schema.Array(WorkflowEntry)) }))
        ),
        base: Schema.optional(
          Schema.NullOr(
            Schema.Struct({
              statusCheckRollup: Schema.optional(Schema.NullOr(Schema.Struct({ state: Schema.String }))),
            })
          )
        ),
      })
    )
  ),
});

export const BranchView = Schema.Struct({
  protection: Schema.optional(
    Schema.Struct({
      required_status_checks: Schema.optional(
        Schema.NullOr(
          Schema.Struct({
            contexts: Schema.optional(Schema.Array(Schema.Unknown)),
            checks: Schema.optional(Schema.Array(Schema.Unknown)),
          })
        )
      ),
    })
  ),
});

export const BranchRules = Schema.Array(
  Schema.Struct({
    type: Schema.optional(Schema.String),
    parameters: Schema.optional(
      Schema.Struct({ required_status_checks: Schema.optional(Schema.Array(Schema.Unknown)) })
    ),
  })
);

export interface RepoCiCache {
  resolve(repo: Repo, base: string, signal?: AbortSignal): Effect.Effect<RepoCi>;
}

export const CI_QUERY = `query($owner:String!,$name:String!,$workflows:String!,$base:String!){repository(owner:$owner,name:$name){workflows:object(expression:$workflows){... on Tree{entries{name object{... on Blob{text}}}}} base:object(expression:$base){... on Commit{statusCheckRollup{state}}}}}`;

export const CHECK_TRIGGERS = new Set(['push', 'pull_request', 'pull_request_target']);

export const WORKFLOW_FILE = /\.ya?ml$/;

export const KNOWN_CI_TTL = Duration.hours(1);

export const UNKNOWN_CI_TTL = Duration.minutes(5);
