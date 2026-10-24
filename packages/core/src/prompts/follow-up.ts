import { type Repo, resolveCurrentRound, SHAPE_LIMITS, type Task } from '../domain/index.ts';
import { describeEarlierWork, describeGoal, describeRepository, describeTaskLink } from './context.ts';
import { resolveHouseRules } from './rules.ts';

function describeHeadline(task: Task) {
  const headline = task.report?.headline ?? task.summary;
  return headline ? ['', 'What it did:', headline].join('\n') : '';
}

export function resolveFollowUpPrompt(task: Task, repo: Repo | null, question: string | null) {
  const round = resolveCurrentRound(task);
  return [
    resolveHouseRules('answerer'),
    '',
    `Your role: answerer. Round ${round.number} of this task is finished, and the human asked a follow-up about it. Answer it.`,
    'A follow-up builds, runs and changes nothing. Answer from what the round did and from the repository, and use tools only to look things up.',
    describeTaskLink(task),
    describeRepository(repo),
    repo ? `The repository is checked out at \`${repo.path}\`. Read it; never change it.` : '',
    '',
    `What round ${round.number} was asked to do:`,
    round.number > 1 ? round.request : task.request,
    describeGoal(task),
    describeHeadline(task),
    describeEarlierWork(task),
    '',
    question
      ? ['The follow-up:', question].join('\n')
      : 'Answer the follow-up the human asked in this conversation.',
    '',
    `Call \`answer\` with your answer in markdown (at most ${SHAPE_LIMITS.answer} characters): lead with the answer itself, then the evidence (files and lines as shinsa:// links).`,
    'Propose no change with it: when the human wants more done, they ask, and Shinsa starts a new round. Work worth doing outside this task goes to `suggest_tasks`. Then stop.',
  ].join('\n');
}
