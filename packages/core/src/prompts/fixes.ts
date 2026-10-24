import { describeCount } from '../chat/text.ts';
import type { PullRequest, PullRequestWatchChange } from '../domain/index.ts';
import type { ReportCheck, ReviewFinding } from '../report/types.ts';
import { describeFindingPlace } from './context.ts';

function describeFindingLines(findings: ReviewFinding[]) {
  return findings
    .map((finding) => `- [${finding.severity}] ${describeFindingPlace(finding)}${finding.message}`)
    .join('\n');
}

function describeCheckFailures(results: ReportCheck[]) {
  return results
    .filter((check) => check.outcome === 'fail')
    .map((check) =>
      [`- \`${check.name}\` failed:`, check.detail ? `\`\`\`\n${check.detail}\n\`\`\`` : ''].join('\n')
    )
    .join('\n');
}

function describeFixClosing(next: string) {
  return [
    '',
    'Fix it, re-run the checks yourself, then call `complete_fix` with a one or two sentence summary of what you changed.',
    `${next} Then end your turn.`,
  ].join('\n');
}

const WORK_FIX_NEXT =
  "Afterwards Shinsa runs the task's checks and agent review, where it has them, and then the human reviews the work.";

export function resolveChecksFixPrompt(results: ReportCheck[]) {
  return [
    'The checks failed after the last change:',
    '',
    describeCheckFailures(results),
    describeFixClosing(WORK_FIX_NEXT),
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

export function resolveHumanFixPrompt(message: string) {
  return ['The human looked at the work and wrote:', '', message, describeFixClosing(WORK_FIX_NEXT)].join(
    '\n'
  );
}

function describeVerdict(finding: ReviewFinding) {
  const note = finding.verdictNote ? ` (the human: ${finding.verdictNote})` : '';
  return `${describeFindingLines([finding])}${note}`;
}

export function resolveVerdictFixPrompt(findings: ReviewFinding[], message: string | null) {
  const fix = findings.filter((finding) => finding.verdict === 'fix');
  const dismissed = findings.filter((finding) => finding.verdict === 'dismiss');
  return [
    'The human looked at the work and decided on each review finding.',
    ...(fix.length > 0 ? ['', 'Fix these:', ...fix.map(describeVerdict)] : []),
    ...(dismissed.length > 0
      ? ['', 'Leave these alone; the human dismissed them:', ...dismissed.map(describeVerdict)]
      : []),
    ...(message?.trim() ? ['', 'The human also wrote:', message.trim()] : []),
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

function describeStandingProblems(pullRequest: PullRequest) {
  return [
    pullRequest.checks === 'failing'
      ? '- CI checks are failing. Read the failing logs with `gh pr checks` and `gh run view`.'
      : '',
    pullRequest.unresolvedComments > 0
      ? `- ${describeUnresolved(pullRequest.unresolvedComments)} (review bots or people). Read them with \`gh pr view ${pullRequest.number} --comments\` and the review threads API.`
      : '',
    pullRequest.mergeable === false
      ? '- The branch has merge conflicts with its base. Merge the base branch into it and resolve them; never rebase or force-push.'
      : '',
  ].filter(Boolean);
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
    `Pull request #${pullRequest.number} needs work before the human can merge it.`,
    ...(rejection ? ['', rejection] : []),
    ...(news.length > 0 ? ['', 'New since Shinsa last looked:', ...news] : []),
    ...(standing.length > 0 ? ['', 'Where it stands:', ...standing] : []),
    '',
    'Fix what is right to fix. Judge each review comment: when one is wrong, reply on the thread explaining why and resolve it.',
    describeFixClosing('Afterwards Shinsa pushes your fix to the pull request.'),
  ].join('\n');
}
