import type { CommandOf } from '../commands/index.ts';
import {
  DomainError,
  isTaskSettled,
  RUN_STAGES,
  type Run,
  type RunOutcome,
  type RunRole,
} from '../model/index.ts';
import { RUN_AGENT_ROLE } from '../models/index.ts';
import { listActiveRuns } from '../state/queries.ts';
import type { Decider } from './decider.ts';

const MAX_RECOVERIES = 1;

export function findCurrentRun(decider: Decider, runId: string, roles: readonly RunRole[]) {
  const run = decider.state.runs[runId];
  if (!run) throw new DomainError('run_not_found', `No run ${runId}`);
  if (run.endedAt !== null) throw new DomainError('run_over', 'This step is already over. End your turn.');
  const task = decider.task(run.taskId);
  if (isTaskSettled(task)) throw new DomainError('task_settled', 'This task is finished. End your turn.');
  if (!roles.includes(run.role)) throw new DomainError('wrong_role', `A ${run.role} cannot do that.`);
  return { run, task };
}

function recover(decider: Decider, run: Run, why: string) {
  const task = decider.task(run.taskId);
  if (task.recoveries >= MAX_RECOVERIES) {
    decider.fail(task.id, `The ${RUN_AGENT_ROLE[run.role]} paused`, why, run.id);
    return;
  }
  decider.emit({ type: 'task.recovered', taskId: task.id, recoveries: task.recoveries + 1 });
  const nudge = `\n\nYour previous attempt ended without handing over (${why}). Continue and finish with the hand-over tool.`;
  const role: RunRole = run.role === 'shipper' ? 'fixer' : run.role;
  decider.startRun(decider.task(task.id), role, `${run.prompt ?? ''}${nudge}`, {
    resumeFrom: run,
    phaseIndex: run.phaseIndex ?? null,
  });
}

function describeStop(outcome: RunOutcome, summary: string | null) {
  if (outcome === 'failed') return summary ?? 'it stopped with an error';
  return 'it ended its turn without calling the hand-over tool';
}

export function endRun(decider: Decider, command: CommandOf<'run.end'>) {
  const run = decider.state.runs[command.runId];
  if (!run || run.endedAt !== null) return;
  decider.endRun(run, command.outcome, command.summary);
  const task = decider.task(run.taskId);
  if (isTaskSettled(task) || command.outcome === 'cancelled' || !RUN_STAGES.has(task.stage)) return;
  recover(decider, run, describeStop(command.outcome, command.summary));
}

export function linkRun(decider: Decider, command: CommandOf<'run.link'>) {
  const run = decider.state.runs[command.runId];
  if (!run || run.sessionId === command.sessionId) return;
  decider.emit({ type: 'run.linked', runId: command.runId, sessionId: command.sessionId });
}

export function dispatchRuns(decider: Decider) {
  for (const run of listActiveRuns(decider.state)) {
    if (run.status !== 'queued') continue;
    decider.emit({ type: 'run.dispatched', runId: run.id });
    decider.run({ kind: 'run.execute', runId: run.id });
  }
}
