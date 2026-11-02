import type { FeedbackIssue, FeedbackSource } from '@shinsa/core';
import { Effect, Schema } from 'effect';

export interface FeedbackIssueInput {
  source: FeedbackSource;
  title: string;
  body: string;
}

export type FiledIssue = Pick<FeedbackIssue, 'number' | 'url'>;

export type FeedbackFiling = { ok: true; issue: FiledIssue } | { ok: false; detail: string };

export type FeedbackIssueStates = Map<number, number | null>;

export type FeedbackListing = { ok: true; states: FeedbackIssueStates } | { ok: false; detail: string };

export class FeedbackAnswerInvalid extends Schema.TaggedError<
  FeedbackAnswerInvalid,
  { readonly brand: unique symbol }
>()('FeedbackAnswerInvalid', { message: Schema.String }) {}

const LenientText = Schema.String.pipe(Schema.catchDecoding(() => Effect.succeedNone));

export const ListedIssue = Schema.Struct({
  number: Schema.Number,
  state: Schema.optionalKey(LenientText),
  closedAt: Schema.optionalKey(LenientText),
});
export type ListedIssue = typeof ListedIssue.Type;

export const ListedIssuesText = Schema.fromJsonString(Schema.Array(Schema.Unknown));

export const ISSUE_URL = /https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/issues\/(\d+)/g;

export const FOOTERS: Record<FeedbackSource, string> = {
  human: 'Sent from the feedback button in Shinsa.',
  agent: 'Reported by an agent working in Shinsa, then read and sent by the person it works for.',
};

export const ISSUE_LIST_LIMIT = 500;

export const MISSING_LINK = 'GitHub answered without the new issue’s link: ';

export const MISSING_LIST = 'GitHub answered without a list of issues: ';
