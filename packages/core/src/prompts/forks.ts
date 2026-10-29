import { type Round, resolveCurrentRound, resolveTaskRounds, type Task } from '../domain/index.ts';
import { resolveRoundOutcome } from '../state/rounds.ts';
import { describeRoundPullRequest, ROUND_STATE } from './context.ts';

const FORK_SUMMARY_LIMIT = 600;

function describeForkName(task: Task) {
  return task.handle ? `${task.handle} “${task.title}”` : `“${task.title}”`;
}

function describeRoundWork(source: Task, round: Round) {
  const current = resolveCurrentRound(source).number === round.number;
  const outcome = round.outcome ?? (current ? resolveRoundOutcome(source) : null);
  const summary = outcome?.headline ?? outcome?.result ?? outcome?.goal ?? null;
  const line = `- Round ${round.number}: ${round.title} (${ROUND_STATE[round.status]}${describeRoundPullRequest(round)})`;
  return summary ? `${line}: ${summary.slice(0, FORK_SUMMARY_LIMIT)}` : line;
}

function describeForkCode(source: Task) {
  const pullRequest = source.pullRequest;
  if (pullRequest?.state === 'merged') {
    return `Its change merged in pull request #${pullRequest.number}, so the default branch this task starts from has it.`;
  }
  const branch = source.branch ? `on branch ${source.branch}` : 'on its own branch';
  const opened = pullRequest ? ` in pull request #${pullRequest.number}` : '';
  return `Its change is not merged yet: it is ${branch}${opened}, not on the default branch this task starts from, so this worktree does not have it.`;
}

function describeForkPlace(source: Task) {
  return [
    describeForkCode(source),
    source.worktreePath && source.pullRequest?.state !== 'merged'
      ? `Read its code in its worktree, \`${source.worktreePath}\`, when you need it, but never change anything there.`
      : '',
    `Read the task itself with \`read_task\` (id ${source.id}) when you need more.`,
  ].filter(Boolean);
}

export function resolveForkNote(source: Task) {
  return [
    '',
    '',
    `Everything above this message was the work of the task ${describeForkName(source)}. It was copied into this new task, so you keep all it learned.`,
    ...describeForkPlace(source),
    'That task stays as it is: never change its branch, its worktree or its pull request.',
    'From here on you work on this task only, with its own branch, worktree, review and pull request, and its own request, given in this message.',
  ].join('\n');
}

export function describeForkSource(source: Task) {
  return [
    '',
    '',
    `This task carries on from the task ${describeForkName(source)}. You do not have its conversation, so here is what it was asked and what it did.`,
    'Its request:',
    source.request,
    'Its rounds:',
    ...resolveTaskRounds(source).map((round) => describeRoundWork(source, round)),
    ...describeForkPlace(source),
    'That task stays as it is: never change its branch, its worktree or its pull request.',
  ].join('\n');
}
