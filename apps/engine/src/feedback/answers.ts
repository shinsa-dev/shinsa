import { Option, Schema } from 'effect';
import {
  type FeedbackIssueInput,
  type FeedbackIssueStates,
  FOOTERS,
  type FiledIssue,
  ISSUE_URL,
  ListedIssue,
  type ListedIssue as ListedIssueType,
  ListedIssuesText,
} from './schema.ts';

const decodeList = Schema.decodeUnknownOption(ListedIssuesText);

const decodeIssue = Schema.decodeUnknownOption(ListedIssue);

export function serializeFeedbackBody(input: FeedbackIssueInput) {
  return `${input.body}\n\n---\n_${FOOTERS[input.source]}_\n`;
}

export function parseIssueUrl(output: string): FiledIssue | null {
  const found = [...output.matchAll(ISSUE_URL)].at(-1);
  return found?.[1] ? { number: Number(found[1]), url: found[0] } : null;
}

function readClosedAt(issue: ListedIssueType) {
  if (issue.state !== 'CLOSED' || issue.closedAt === undefined) return null;
  const closedAt = Date.parse(issue.closedAt);
  return Number.isNaN(closedAt) ? null : closedAt;
}

export function parseIssueStates(output: string): FeedbackIssueStates | null {
  return Option.getOrNull(
    Option.map(
      decodeList(output),
      (listed): FeedbackIssueStates =>
        new Map(
          listed.flatMap((item) =>
            Option.match(decodeIssue(item), {
              onNone: () => [],
              onSome: (issue) => [[issue.number, readClosedAt(issue)] as const],
            })
          )
        )
    )
  );
}
