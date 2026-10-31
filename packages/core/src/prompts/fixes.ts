import { describeCount } from '../chat/text.ts';
import { isBlockingCheck } from '../domain/checks.ts';
import type { PullRequest, PullRequestWatchChange, ReviewComment } from '../domain/index.ts';
import type { ReportCheck, ReviewFinding } from '../report/types.ts';
import { describeFindingPlace } from './context.ts';

const SEVERITY_WORDS: Record<ReviewFinding['severity'], string> = {
  blocking: 'blocking',
  should_fix: 'should fix',
  optional: 'optional',
};

function describeFindingLines(findings: ReviewFinding[]) {
  return findings
    .map(
      (finding) =>
        `- [${SEVERITY_WORDS[finding.severity]}] ${describeFindingPlace(finding)}${finding.message}`
    )
    .join('\n');
}

function describeCheckFailures(results: ReportCheck[]) {
  return results
    .filter(isBlockingCheck)
    .map((check) =>
      [
        `- ${check.id}, ${check.label}: \`${check.command}\` failed:`,
        check.detail ? `\`\`\`\n${check.detail}\n\`\`\`` : '',
      ].join('\n')
    )
    .join('\n');
}

function describeFixClosing(next: string) {
  return [
    '',
    'Fix it, confirming the fix with the test files or folders it touches, never the whole suite (Shinsa refuses it): Shinsa runs the checks itself after you hand over.',
    'Then call `complete_fix` with a one or two sentence summary of what you changed. Shinsa runs again the checks that failed, the checks of every phase whose files your fix changes, and the ones you name in `checks` by their ids; add, change or remove a check with `check_changes` and a reason when the fix needs one.',
    'When the fix changes the approach, the flow, a risk, how to test it or the steps the human takes around the merge, also send `walkthrough` with only the parts that changed. Otherwise leave it out.',
    'When the fix changes what your evidence shows, refresh it before you hand over: attach the new shot with the same `key` so it replaces the old one (never add it beside it), remove what no longer applies with `remove_evidence`, and name in `evidence_kept` what still shows the work as it is.',
    `${next} Then stop.`,
  ].join('\n');
}

const WORK_FIX_NEXT =
  'Afterwards Shinsa runs those checks, then the agent review where the task has one, and then the human reviews the work.';

const PHASE_FIX_NEXT = 'Afterwards Shinsa runs those checks, then you build the next phase.';

export function resolveChecksFixPrompt(results: ReportCheck[], phasesLeft: boolean) {
  return [
    "The checks failed after the last change. Shinsa ran each failing test file alone and on the base branch first: these failures are the change's own.",
    '',
    describeCheckFailures(results),
    describeFixClosing(phasesLeft ? PHASE_FIX_NEXT : WORK_FIX_NEXT),
  ].join('\n');
}

export function resolveReviewFixPrompt(findings: ReviewFinding[]) {
  return [
    'The agent review found problems. Fix every blocking finding and the suggestions that are clearly right.',
    'Judge each one: if a finding is wrong, say why in your summary instead of changing code.',
    '',
    describeFindingLines(findings),
    describeFixClosing(WORK_FIX_NEXT),
  ].join('\n');
}

function describeCommentLines(comment: ReviewComment) {
  const plural = comment.endLine !== null;
  const lines = plural ? `${comment.line}-${comment.endLine}` : String(comment.line);
  return `${comment.side === 'old' ? 'removed ' : ''}${plural ? 'lines' : 'line'} ${lines}`;
}

function describeLineComment(comment: ReviewComment) {
  return `- ${comment.path}, ${describeCommentLines(comment)}: ${comment.text}`;
}

function describeLineComments(comments: readonly ReviewComment[]) {
  if (comments.length === 0) return [];
  return ['', 'Line comments:', ...comments.map(describeLineComment)];
}

const REPLY_INSTRUCTION = [
  '',
  'This fix answers the human, so `complete_fix` also takes `reply`, which they read on the overview instead of the chat:',
  '- `headline`: one sentence, what you did about their request.',
  '- `points`: each thing they raised, in their words cut short, with its outcome (`done`, `answered` for a question, `not_changed` when you left it as it was) and a note: where it is now, the answer, or why you left it.',
  '- `next`: what they do now to see or try it, in markdown, with the exact commands and links. Leave it out when there is nothing.',
  '- `details`: anything else worth knowing, in markdown. Leave it out when the points say it all.',
].join('\n');

export function resolveHumanFixPrompt(message: string | null, comments: readonly ReviewComment[]) {
  const note = message?.trim() ?? '';
  const opening =
    note || comments.length === 0
      ? ['The human looked at the work and wrote:', '', note || 'Revise the work.']
      : ['The human looked at the work and left line comments.'];
  return [
    ...opening,
    ...describeLineComments(comments),
    ...(note
      ? [
          '',
          'When it asks you to run or start something so the human can try the work (a dev server, a service), to check something or to answer a question, rather than to change the work, do that, say what you did in the reply, and call `complete_fix` all the same.',
        ]
      : []),
    REPLY_INSTRUCTION,
    describeFixClosing(WORK_FIX_NEXT),
  ].join('\n');
}

function describeVerdict(finding: ReviewFinding) {
  const note = finding.verdictNote ? ` (the human: ${finding.verdictNote})` : '';
  return `${describeFindingLines([finding])}${note}`;
}

export function resolveVerdictFixPrompt(
  findings: ReviewFinding[],
  message: string | null,
  comments: readonly ReviewComment[]
) {
  const fix = findings.filter((finding) => finding.verdict === 'fix');
  const dismissed = findings.filter((finding) => finding.verdict === 'dismiss');
  return [
    'The human looked at the work and decided on each review finding.',
    ...(fix.length > 0 ? ['', 'Fix these:', ...fix.map(describeVerdict)] : []),
    ...(dismissed.length > 0
      ? ['', 'Leave these alone; the human dismissed them:', ...dismissed.map(describeVerdict)]
      : []),
    ...(message?.trim() ? ['', 'The human also wrote:', message.trim()] : []),
    ...describeLineComments(comments),
    REPLY_INSTRUCTION,
    describeFixClosing(WORK_FIX_NEXT),
  ].join('\n');
}

function listItems<T>(items: T[], total: number, line: (item: T) => string) {
  const lines = items.map(line);
  if (total > items.length) lines.push(`  - and ${total - items.length} more`);
  return lines;
}

function describeChange(change: PullRequestWatchChange, commit: string) {
  switch (change.kind) {
    case 'checks_failed':
      return [
        `- Checks failed${commit}:`,
        ...listItems(change.failed, change.total ?? change.failed.length, (check) => {
          const status = check.status === 'failure' ? '' : ` (${check.status.replaceAll('_', ' ')})`;
          return `  - ${check.name}${status}${check.url ? ` ${check.url}` : ''}`;
        }),
      ];
    case 'checks_passed':
      return [];
    case 'remarks':
      return [
        `- ${describeCount(change.total ?? change.remarks.length, 'new comment')}:`,
        ...listItems(change.remarks, change.total ?? change.remarks.length, (remark) => {
          const where = remark.path ? ` on ${remark.path}` : '';
          const said = remark.body ? `"${remark.body}"` : (remark.reviewState ?? 'reviewed');
          return `  - ${remark.author ?? 'someone'}${where}: ${said}${remark.url ? ` ${remark.url}` : ''}`;
        }),
      ];
    case 'conflicting':
      return ['- The branch now conflicts with its base.'];
  }
}

function describeUnresolved(count: number) {
  return count === 1
    ? 'There is 1 unresolved review comment'
    : `There are ${count} unresolved review comments`;
}

function describeMergeConflict(pullRequest: PullRequest) {
  const base = pullRequest.base ?? null;
  if (!base) {
    return '- The branch has merge conflicts with its base. Fetch the base branch, merge it in with `git merge`, resolve every conflict and `git add` the files. Leave the merge uncommitted: Shinsa commits it with your fix. Never rebase or force-push.';
  }
  return `- The branch has merge conflicts with its base, \`${base}\`. Shinsa fetched it: merge it in with \`git merge origin/${base}\`, resolve every conflict and \`git add\` the files. Leave the merge uncommitted: Shinsa commits it with your fix. Never rebase or force-push.`;
}

function describeStandingProblems(pullRequest: PullRequest) {
  return [
    pullRequest.checks === 'failing'
      ? '- CI checks are failing. Read the failing logs with `gh pr checks` and `gh run view`.'
      : '',
    pullRequest.unresolvedComments > 0
      ? `- ${describeUnresolved(pullRequest.unresolvedComments)} (review bots or people). Read them with \`gh pr view ${pullRequest.number} --comments\` and the review threads API.`
      : '',
    pullRequest.mergeable === false ? describeMergeConflict(pullRequest) : '',
  ].filter(Boolean);
}

function describePullRequestOpening(pullRequest: PullRequest) {
  if (pullRequest.mergeable !== false)
    return `Pull request #${pullRequest.number} needs work before the human can merge it.`;
  const base = pullRequest.base ? `\`${pullRequest.base}\`` : 'its base';
  return `The pull request conflicts with ${base}, so the human cannot merge #${pullRequest.number} until you resolve the conflicts.`;
}

export function resolvePullRequestFixPrompt(
  pullRequest: PullRequest,
  changes: PullRequestWatchChange[] = [],
  rejection: string | null = null
) {
  const commit = pullRequest.headSha ? ` on ${pullRequest.headSha.slice(0, 7)}` : '';
  const news = changes.flatMap((change) => describeChange(change, commit));
  const standing = describeStandingProblems(pullRequest);
  return [
    describePullRequestOpening(pullRequest),
    ...(rejection ? ['', rejection] : []),
    ...(news.length > 0 ? ['', 'New since Shinsa last looked:', ...news] : []),
    ...(standing.length > 0 ? ['', 'Where it stands:', ...standing] : []),
    '',
    'Fix what is right to fix. Judge each review comment: when one is wrong, reply on the thread explaining why and resolve it.',
    describeFixClosing('Afterwards Shinsa pushes your fix to the pull request.'),
  ].join('\n');
}

export function resolveUpdateConflictFixPrompt(base: string, files: readonly string[]) {
  return [
    `The branch was being updated onto \`${base}\` before Shinsa pushed it, and these files conflict:`,
    ...files.map((file) => `- ${file}`),
    '',
    `Shinsa stopped that merge, so the checkout is clean. Shinsa fetched \`${base}\`: merge it in with \`git merge origin/${base}\`, resolve every conflict and \`git add\` the files. Leave the merge uncommitted: Shinsa commits it with your fix. Never rebase or force-push.`,
    describeFixClosing(
      'Afterwards Shinsa runs the checks the resolved files touch, then updates the branch again and pushes it.'
    ),
  ].join('\n');
}

export function resolveCodeFence(output: string) {
  const longest = Math.max(2, ...[...output.matchAll(/`+/g)].map((match) => match[0].length));
  return '`'.repeat(longest + 1);
}

export function resolvePushHookFixPrompt(
  output: string,
  failures: readonly string[] | null,
  guidance: string | null
) {
  const fence = resolveCodeFence(output);
  return [
    "The repository's pre-push hook rejected the push, so Shinsa did not push the branch. Shinsa never pushes without the hook: it has to pass.",
    ...(failures && failures.length > 0
      ? ['', 'The failures it names:', ...failures.map((failure) => `- ${failure}`)]
      : []),
    '',
    'The end of its output:',
    `${fence}\n${output}\n${fence}`,
    '',
    'Run only the failing tests or checks named above, scoped to their files, never the whole suite the hook runs. When a failure has nothing to do with this change, fix it anyway if it is small; otherwise ask the human with `ask`.',
    ...(guidance?.trim() ? ['', `Guidance from the human: ${guidance.trim()}`] : []),
    describeFixClosing(
      'Afterwards Shinsa runs the checks your fix touches, then pushes again, which runs the hook again.'
    ),
  ].join('\n');
}
