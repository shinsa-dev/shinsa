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

export function resolveForkNote(source: Task) {
  return [
    '',
    '',
    `Everything above this message was the work of the task ${describeForkName(source)}. It was copied into this new task, so you keep all it learned.`,
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
    'That task stays as it is: never change its branch, its worktree or its pull request. Read it with `read_task` when you need more.',
  ].join('\n');
}
