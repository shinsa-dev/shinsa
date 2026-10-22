import type { Repo, Task } from '../model/index.ts';
import {
  baseLine,
  checksLine,
  goalBlock,
  isStacked,
  planBlock,
  previousPhasesBlock,
  repoLine,
  resolveLaterMessages,
  taskLine,
} from './context.ts';
import { HOUSE_RULES } from './rules.ts';

export function resolvePlannerPrompt(task: Task, repo: Repo | null, bases: Task[], feedback: string | null) {
  return [
    HOUSE_RULES,
    '',
    'Your role: planner. Plan this piece of work. Do not change any code.',
    taskLine(task),
    repoLine(repo),
    baseLine(bases),
    '',
    'The human asked for:',
    task.intent,
    resolveLaterMessages(task),
    feedback ? ['', 'Feedback on the previous plan:', feedback, '', task.spec?.body ?? ''].join('\n') : '',
    '',
    'Read the code you need to understand the change, then call `propose_plan`.',
    'The `plan` splits the work into 2 to 8 phases, in order. Each phase is built by a separate agent that sees the plan,',
    'its own phase and the summaries of the phases before it, so a phase must be a self-contained step with a clear end:',
    'a title of a few words and one or two sentences saying exactly what is done and how it is verified.',
    'Small changes still get a plan; two or three phases is fine.',
    'Decide everything you can decide from the code and the request, and say so in the approach.',
    'If the human must decide something before work can start, ask it with `ask` first, then plan with the answer.',
    'Leave `questions` empty unless a decision can wait for the human to look at the finished work.',
    'Then end your turn.',
  ].join('\n');
}

export function resolvePhasePrompt(task: Task, repo: Repo | null, bases: Task[], index: number) {
  const plan = task.spec?.document?.plan ?? [];
  const phase = plan[index];
  const last = index >= plan.length - 1;
  return [
    HOUSE_RULES,
    '',
    `Your role: builder for phase ${index + 1} of ${Math.max(plan.length, 1)}. Do this phase completely, and only this phase.`,
    taskLine(task),
    repoLine(repo),
    baseLine(bases),
    '',
    'The human asked for:',
    task.intent,
    '',
    goalBlock(task),
    planBlock(task),
    task.specAnswers ? ['', 'The human answered:', task.specAnswers].join('\n') : '',
    '',
    previousPhasesBlock(task, index),
    '',
    phase ? `Your phase: ${phase.title}. ${phase.detail}` : 'Your phase: build the whole change.',
    '',
    'Work until the phase is done and verified, not until it compiles.',
    checksLine(repo),
    last
      ? 'This is the last phase: the whole change must work end to end when you finish.'
      : 'Later phases build on yours; leave the code in a working state.',
    'For user-facing changes, run the app and attach screenshots or a short recording with `attach_evidence`.',
    'For logic, write the test that fails without your change and passes with it.',
    'When the phase is done, call `complete_phase`:',
    '- summary: what this phase changed, in one or two sentences.',
    '- spots: the exact line ranges (new-file line numbers) the human must read, each with why it matters.',
    '  critical = could break something or encodes a judgement call; high = worth a careful read; normal = context.',
    '  Leave boilerplate and mechanical edits out.',
    '- decisions: judgement calls the human might disagree with.',
    'Then end your turn.',
  ].join('\n');
}

export function resolveReviewerPrompt(task: Task, repo: Repo | null, bases: Task[]) {
  const stacked = bases.find((base) => base.branch && isStacked(base));
  return [
    HOUSE_RULES,
    '',
    'Your role: reviewer. You did not write this code. Review it against the request, the plan and the repository rules. Do not edit code.',
    taskLine(task),
    repoLine(repo),
    '',
    'The human asked for:',
    task.intent,
    '',
    goalBlock(task),
    planBlock(task),
    '',
    'What the builders say they did:',
    ...task.phaseReports.map((report) => `- ${report.summary}`),
    '',
    stacked
      ? `This task is stacked on ${stacked.branch}. Diff against that branch and review only this task's changes.`
      : `Diff the branch against ${repo?.defaultBranch ?? 'the default branch'} and read every change.`,
    'Shinsa already ran the checks and they pass. Look for what checks miss.',
    'A blocking finding is a bug, a missed requirement, a broken repository rule or a security problem. Everything optional is a suggestion.',
    'Anchor every finding to a file and line range. Reproduce a finding before you report it; one you cannot reproduce is a guess.',
    'Call `report_review` with your findings (an empty list if there are none), then end your turn.',
    'You are a signal for the human, never the approval.',
  ].join('\n');
}
