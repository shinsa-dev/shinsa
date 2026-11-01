import type { UserCommand } from '../commands/index.ts';
import type { Gate, GateType, Run, RunAccount, Task } from '../domain/index.ts';
import { createState, type ShinsaState } from '../state/project.ts';
import { LOCAL_ONLY_MESSAGE } from './local-only.ts';

export const SCOPED_COMMANDS = [
  'task.prioritize',
  'task.move_to_backlog',
  'task.remove_from_backlog',
  'task.snooze',
  'task.unsnooze',
  'task.cancel',
  'task.clear_duplicate',
  'task.complete',
  'task.retry',
  'task.message',
  'round.ship',
  'round.update',
  'round.remove',
  'round.send',
  'gate.answer',
  'merge_step.tick',
  'suggestion.dismiss',
  'suggestion.keep',
  'monitor.check_in_now',
  'run.snooze_silence',
  'run.dismiss_silence',
  'usage_wait.change',
  'usage_wait.resume_now',
  'delegation.cancel',
  'watchdog.stop',
] as const satisfies readonly UserCommand['type'][];

type ScopedCommand = Extract<UserCommand, { type: (typeof SCOPED_COMMANDS)[number] }>;

const SCOPED_COMMAND_SET: ReadonlySet<string> = new Set(SCOPED_COMMANDS);

const KEYBOARD_GATES: ReadonlySet<GateType> = new Set<GateType>(['secret', 'sign_in']);

export const SCOPE_REFUSAL_CODE = 'handoff_scope';

export const SCOPE_MESSAGES = {
  command: 'This stays with the owner of the task. You were handed one task to work on.',
  task: 'You can only work on the task that was handed to you.',
  gate: 'Only the owner of the task can answer this, on their machine.',
} as const;

function isScopedCommand(command: UserCommand): command is ScopedCommand {
  return SCOPED_COMMAND_SET.has(command.type);
}

function resolveCommandTask(state: ShinsaState, command: ScopedCommand) {
  if ('taskId' in command) return command.taskId;
  if ('runId' in command) return state.runs[command.runId]?.taskId ?? null;
  return state.gates[command.gateId]?.taskId ?? null;
}

export function resolveScopedRefusal(state: ShinsaState, taskId: string, command: UserCommand) {
  if (!isScopedCommand(command)) return SCOPE_MESSAGES.command;
  if (resolveCommandTask(state, command) !== taskId) return SCOPE_MESSAGES.task;
  if (command.type === 'task.retry' && command.account) return LOCAL_ONLY_MESSAGE;
  const gate = command.type === 'gate.answer' ? state.gates[command.gateId] : undefined;
  if (gate && KEYBOARD_GATES.has(gate.type)) return SCOPE_MESSAGES.gate;
  return null;
}

function redactAccount<T extends RunAccount | null | undefined>(account: T): T {
  return (account ? { id: account.id, email: null } : account) as T;
}

function redactTask(task: Task): Task {
  const { share: _share, previews: _previews, account, usageWait, handoff, ...rest } = task;
  return {
    ...rest,
    ...(account === undefined ? {} : { account: redactAccount(account) }),
    ...(usageWait ? { usageWait: { ...usageWait, account: redactAccount(usageWait.account) } } : {}),
    ...(handoff ? { handoff: { ...handoff, url: null } } : {}),
  };
}

function redactRun(run: Run): Run {
  return {
    ...run,
    ...(run.account === undefined ? {} : { account: redactAccount(run.account) }),
    ...(run.attempts
      ? { attempts: run.attempts.map((attempt) => ({ ...attempt, account: redactAccount(attempt.account) })) }
      : {}),
    ...(run.failure ? { failure: { ...run.failure, account: redactAccount(run.failure.account) } } : {}),
  };
}

function redactGate(gate: Gate): Gate {
  return gate.account === undefined ? gate : { ...gate, account: redactAccount(gate.account) };
}

function pickRecords<T extends { taskId: string }>(records: Record<string, T>, taskId: string) {
  return Object.fromEntries(Object.entries(records).filter(([, record]) => record.taskId === taskId));
}

function mapRecords<T>(records: Record<string, T>, redact: (record: T) => T) {
  return Object.fromEntries(Object.entries(records).map(([id, record]) => [id, redact(record)]));
}

export function resolveScopedState(state: ShinsaState, taskId: string): ShinsaState {
  const scoped = { ...createState(), seq: state.seq };
  const task = state.tasks[taskId];
  if (!task) return scoped;
  const repo = task.repoId ? state.repos[task.repoId] : undefined;
  const project = task.projectId ? state.projects[task.projectId] : undefined;
  return {
    ...scoped,
    tasks: { [task.id]: redactTask(task) },
    runs: mapRecords(pickRecords(state.runs, taskId), redactRun),
    gates: mapRecords(pickRecords(state.gates, taskId), redactGate),
    evidence: pickRecords(state.evidence, taskId),
    repos: repo ? { [repo.id]: repo } : {},
    projects: project ? { [project.id]: project } : {},
  };
}
