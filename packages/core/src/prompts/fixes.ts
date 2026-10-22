import type { PullRequest } from '../model/index.ts';
import type { ReportCheck, ReviewFinding } from '../report/types.ts';

function findingsBlock(findings: ReviewFinding[]) {
  return findings
    .map((finding) => {
      const where = finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ''}: ` : '';
      return `- [${finding.severity}] ${where}${finding.message}`;
    })
    .join('\n');
}

function checksBlock(results: ReportCheck[]) {
  return results
    .filter((check) => check.outcome === 'fail')
    .map((check) =>
      [`- \`${check.name}\` failed:`, check.detail ? `\`\`\`\n${check.detail}\n\`\`\`` : ''].join('\n')
    )
    .join('\n');
}

function fixClosing() {
  return [
    '',
    'Fix it, re-run the checks yourself, then call `complete_fix` with a one or two sentence summary of what you changed.',
    'Shinsa runs the checks and the agent review again afterwards. Then end your turn.',
  ].join('\n');
}

export function resolveChecksFixPrompt(results: ReportCheck[]) {
  return ['The checks failed after the last change:', '', checksBlock(results), fixClosing()].join('\n');
}

export function resolveReviewFixPrompt(findings: ReviewFinding[]) {
  return [
    'The agent review found problems. Fix every blocking finding and the suggestions that are clearly right.',
    'Judge each one: if a finding is wrong, say why in your summary instead of changing code.',
    '',
    findingsBlock(findings),
    fixClosing(),
  ].join('\n');
}

export function resolveHumanFixPrompt(message: string) {
  return ['The human looked at the work and wrote:', '', message, fixClosing()].join('\n');
}

export function resolvePullRequestFixPrompt(pullRequest: PullRequest) {
  const problems = [
    pullRequest.checks === 'failing'
      ? '- CI checks are failing. Read the failing logs with `gh pr checks` and `gh run view`.'
      : '',
    pullRequest.unresolvedComments > 0
      ? `- There are ${pullRequest.unresolvedComments} unresolved review comments (review bots or people). Read them with \`gh pr view ${pullRequest.number} --comments\` and the review threads API.`
      : '',
    pullRequest.mergeable === false
      ? '- The branch has merge conflicts with its base. Merge the base branch into it and resolve them; never rebase or force-push.'
      : '',
  ].filter(Boolean);
  return [
    `Pull request #${pullRequest.number} needs work before the human can merge it:`,
    ...problems,
    '',
    'Fix what is right to fix. Judge each review comment: when one is wrong, reply on the thread explaining why and resolve it.',
    fixClosing(),
  ].join('\n');
}
