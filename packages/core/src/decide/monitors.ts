import type { CommandOf } from '../commands/index.ts';
import { DomainError, MINUTE_MS, type Monitor, RUN_STAGES, type Run, type Task } from '../domain/index.ts';
import { resolveMonitorPrompt } from '../prompts/index.ts';
import type { Decider } from './decider.ts';
import { findCurrentRun } from './runs.ts';

const MONITOR_DEFAULTS = { timeoutMinutes: 24 * 60, maxAttempts: 10 } as const;

function isMonitorSpent(monitor: Monitor, now: number) {
  return monitor.attempts >= monitor.maxAttempts || now >= monitor.timeoutAt;
}

function resolveChain(task: Task, monitorId: string | null | undefined) {
  const monitor = task.monitor;
  return monitor && monitor.id === monitorId ? monitor : null;
}

export function waitFor(decider: Decider, command: CommandOf<'agent.wait_for'>) {
  const { run, task } = findCurrentRun(decider, command.runId, 'wait_for');
  const now = decider.context.now;
  const chain = resolveChain(task, run.monitorId);
  if (chain && isMonitorSpent(chain, now)) {
    runOut(decider, task, chain, run);
    return;
  }
  const nextCheckAt = now + command.checkInMinutes * MINUTE_MS;
  const timeoutAt =
    chain?.timeoutAt ?? now + (command.timeoutMinutes ?? MONITOR_DEFAULTS.timeoutMinutes) * MINUTE_MS;
  if (timeoutAt <= nextCheckAt) {
    throw new DomainError('monitor_invalid', 'The next check must come before the wait times out.');
  }
  const monitor: Monitor = {
    id: chain?.id ?? decider.context.newId(),
    runId: run.id,
    role: run.role,
    phaseIndex: run.phaseIndex ?? null,
    notes: command.notes,
    armedAt: now,
    nextCheckAt,
    timeoutAt,
    attempts: chain?.attempts ?? 0,
    maxAttempts: chain?.maxAttempts ?? command.maxAttempts ?? MONITOR_DEFAULTS.maxAttempts,
    status: 'armed',
  };
  decider.emit({ type: 'monitor.armed', taskId: task.id, monitor });
  decider.endRun(run, 'completed', 'Waiting to check again.');
  decider.stage(task.id, task.stage, 'waiting to check again');
}

function describeExhausted(monitor: Monitor, timedOut: boolean) {
  const checks = `${monitor.attempts} ${monitor.attempts === 1 ? 'check' : 'checks'}`;
  const ending = timedOut
    ? `The wait ran out of time after ${checks}.`
    : `The agent used all ${checks} and still needed to wait.`;
  return [
    `The agent was waiting for: ${monitor.notes}`,
    `${ending} Retry to wake an agent with a fresh set of checks, or cancel the task.`,
  ].join('\n\n');
}

function runOut(decider: Decider, task: Task, monitor: Monitor, run: Run | null) {
  const timedOut = decider.context.now >= monitor.timeoutAt;
  decider.emit({ type: 'monitor.ended', taskId: task.id, monitorId: monitor.id, status: 'exhausted' });
  if (run) decider.endRun(run, 'completed', 'The wait ran out.');
  const title = timedOut ? 'The agent’s wait ran out' : 'The agent’s wait ran out of checks';
  decider.fail(task.id, title, describeExhausted(monitor, timedOut), null, 'monitor');
}

function wake(decider: Decider, task: Task, monitor: Monitor) {
  if (decider.context.now >= monitor.timeoutAt) {
    runOut(decider, task, monitor, null);
    return;
  }
  const attempt = monitor.attempts + 1;
  decider.emit({ type: 'monitor.fired', taskId: task.id, monitorId: monitor.id, attempt });
  decider.stage(task.id, task.stage, 'checking again');
  const waited = decider.state.runs[monitor.runId] ?? null;
  decider.startRun(decider.task(task.id), monitor.role, resolveMonitorPrompt(monitor, attempt), {
    resumeFrom: decider.resumableFrom(waited),
    purpose: waited?.purpose ?? null,
    phaseIndex: monitor.phaseIndex,
    monitorId: monitor.id,
    account: waited?.account ?? null,
    continues: monitor.runId,
  });
}

export function fireMonitor(decider: Decider, command: CommandOf<'monitor.fire'>) {
  const task = decider.state.tasks[command.taskId];
  const monitor = task?.monitor;
  if (!task || !RUN_STAGES.has(task.stage) || monitor?.id !== command.monitorId) return;
  if (monitor.status !== 'armed') return;
  if (command.attempt !== monitor.attempts + 1) return;
  wake(decider, decider.task(command.taskId), monitor);
}

export function checkInNow(decider: Decider, command: CommandOf<'monitor.check_in_now'>) {
  const task = decider.task(command.taskId);
  const monitor = task.monitor;
  if (monitor?.status !== 'armed') {
    throw new DomainError('monitor_not_armed', 'Nothing here waits for a check.');
  }
  wake(decider, task, monitor);
}
