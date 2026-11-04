import { FEEDBACK_REPOSITORY } from '@shinsa/core';
import { Context, Effect, Layer } from 'effect';
import type { GitHubFailed } from '../../github/schema.ts';
import { GitHubCli } from '../../github/service.ts';
import { parseIssueStates, parseIssueUrl, serializeFeedbackBody } from '../answers.ts';
import {
  FeedbackAnswerInvalid,
  type FeedbackIssueInput,
  type FeedbackIssueStates,
  type FiledIssue,
  ISSUE_LIST_LIMIT,
  MISSING_LINK,
  MISSING_LIST,
} from '../schema.ts';

export class FeedbackIssues extends Context.Service<
  FeedbackIssues,
  {
    file(
      input: FeedbackIssueInput,
      cwd: string
    ): Effect.Effect<FiledIssue, GitHubFailed | FeedbackAnswerInvalid>;
    listStates(cwd: string): Effect.Effect<FeedbackIssueStates, GitHubFailed | FeedbackAnswerInvalid>;
  }
>()('shinsa/engine/feedback/issues/FeedbackIssues') {
  static readonly layer = Layer.effect(
    FeedbackIssues,
    Effect.gen(function* () {
      const github = yield* GitHubCli;

      const file = Effect.fn('FeedbackIssues.file')(function* (input: FeedbackIssueInput, cwd: string) {
        const output = yield* github.run(
          ['issue', 'create', '--repo', FEEDBACK_REPOSITORY, `--title=${input.title}`, '--body-file', '-'],
          cwd,
          { input: serializeFeedbackBody(input) }
        );
        const issue = parseIssueUrl(output);
        if (!issue) return yield* new FeedbackAnswerInvalid({ message: `${MISSING_LINK}${output}` });
        return issue;
      });

      const listStates = Effect.fn('FeedbackIssues.listStates')(function* (cwd: string) {
        const output = yield* github.run(
          [
            'issue',
            'list',
            '--repo',
            FEEDBACK_REPOSITORY,
            '--author',
            '@me',
            '--state',
            'all',
            '--limit',
            String(ISSUE_LIST_LIMIT),
            '--json',
            'number,state,closedAt',
          ],
          cwd
        );
        const states = parseIssueStates(output);
        if (!states) return yield* new FeedbackAnswerInvalid({ message: `${MISSING_LIST}${output}` });
        return states;
      });

      return FeedbackIssues.of({ file, listStates });
    })
  );
}
