import { type CommandOf, isUserCommand, type ShinsaCommand, type UserCommand } from '../commands/index.ts';
import type { GateDecision, GateKind } from '../domain/index.ts';
import type { ShinsaState } from '../state/project.ts';
import type { Decider } from './decider.ts';

type Describe<T extends UserCommand['type']> = (state: ShinsaState, command: CommandOf<T>) => string;

type Descriptions = { [T in Exclude<UserCommand['type'], 'task.create'>]: Describe<T> };

const DECISION_WORDS: Record<GateDecision, string> = {
  approve: 'Approved',
  revise: 'Asked for changes to',
  reject: 'Rejected',
  answer: 'Answered',
};

const GATE_WORDS: Record<GateKind, string> = {
  plan: 'the plan',
  review: 'the changes',
  merge: 'the merge',
  question: 'the question',
};

function quoteTask(state: ShinsaState, taskId: string | null) {
  const title = taskId ? state.tasks[taskId]?.title : undefined;
  return title ? `“${title}”` : 'a task';
}

function quoteRunTask(state: ShinsaState, runId: string) {
  return quoteTask(state, state.runs[runId]?.taskId ?? null);
}

function quoteSchedule(state: ShinsaState, scheduleId: string) {
  const name = state.schedules[scheduleId]?.name;
  return name ? `“${name}”` : 'a schedule';
}

const DESCRIPTIONS: Descriptions = {
  'repo.update': (state, command) =>
    `Changed the repository ${state.repos[command.repoId]?.name ?? ''}`.trim(),
  'repo.remove': () => 'Removed a repository',
  'project.write': (_state, command) => `Saved the project “${command.project.name}”`,
  'project.remove': () => 'Removed a project',
  'focus.change': (state, command) =>
    command.projectId
      ? `Focused on ${state.projects[command.projectId]?.name ?? 'a project'}`
      : 'Cleared the focus',
  'settings.change': (_state, command) => `Changed settings: ${Object.keys(command.patch).join(', ')}`,
  'task.prioritize': (state, command) =>
    `Set the priority of ${quoteTask(state, command.taskId)} to ${command.priority}`,
  'task.wait_on': (state, command) => `Changed what ${quoteTask(state, command.taskId)} waits on`,
  'task.cancel': (state, command) => `Cancelled ${quoteTask(state, command.taskId)}`,
  'task.complete': (state, command) => `Marked ${quoteTask(state, command.taskId)} as done`,
  'task.retry': (state, command) => `Retried ${quoteTask(state, command.taskId)}`,
  'task.message': (state, command) => `Messaged ${quoteTask(state, command.taskId)}`,
  'gate.answer': (state, command) => {
    const gate = state.gates[command.gateId];
    const what = gate ? GATE_WORDS[gate.kind] : 'a decision';
    return `${DECISION_WORDS[command.decision]} ${what} on ${quoteTask(state, gate?.taskId ?? null)}`;
  },
  'round.ship': (state, command) =>
    command.shipping === 'stacked'
      ? `Set round ${command.number} of ${quoteTask(state, command.taskId)} to ship as its own stacked pull request`
      : `Set round ${command.number} of ${quoteTask(state, command.taskId)} to ship onto the open pull request`,
  'suggestion.keep': (state, command) =>
    `Kept a split-off of ${quoteTask(state, command.taskId)} as its next round`,
  'monitor.check_in_now': (state, command) => `Checked now what ${quoteTask(state, command.taskId)} waits for`,
  'run.snooze_silence': (state, command) =>
    `Snoozed the quiet agent on ${quoteRunTask(state, command.runId)}`,
  'run.dismiss_silence': (state, command) =>
    `Dismissed the quiet agent on ${quoteRunTask(state, command.runId)}`,
  'usage_wait.change': (state, command) =>
    command.autoResume
      ? `Set ${quoteTask(state, command.taskId)} to resume on its own when the usage limit resets`
      : `Set ${quoteTask(state, command.taskId)} to wait for you when the usage limit resets`,
  'usage_wait.resume_now': (state, command) =>
    `Resumed ${quoteTask(state, command.taskId)} without waiting for the usage limit`,
  'delegation.cancel': (state, command) =>
    `Stopped a delegated task on ${quoteRunTask(state, command.runId)}`,
  'suggestion.accept': (state, command) => `Added a follow-up of ${quoteTask(state, command.taskId)}`,
  'suggestion.dismiss': (state, command) => `Dismissed a follow-up of ${quoteTask(state, command.taskId)}`,
  'task.bind_account': (state, command) =>
    command.account
      ? `Set ${quoteTask(state, command.taskId)} to run on ${command.account.email ?? command.account.id}`
      : `Let ${quoteTask(state, command.taskId)} run on any account`,
  'schedule.enable': (state, command) =>
    `${command.enabled ? 'Resumed' : 'Paused'} the schedule ${quoteSchedule(state, command.scheduleId)}`,
  'schedule.remove': () => 'Deleted a schedule',
  'schedule.write': (_state, command) =>
    command.scheduleId ? 'Changed a schedule' : `Saved the schedule “${command.name ?? 'Schedule'}”`,
};

function selectCreatedTask(decider: Decider) {
  for (const event of decider.events) if (event.type === 'task.created') return event.taskId;
  return null;
}

function selectActionTask(decider: Decider, command: UserCommand) {
  if ('taskId' in command) return command.taskId;
  if ('gateId' in command) return decider.state.gates[command.gateId]?.taskId ?? null;
  if ('runId' in command) return decider.state.runs[command.runId]?.taskId ?? null;
  return selectCreatedTask(decider);
}

function describeAction(decider: Decider, command: UserCommand, taskId: string | null) {
  if (command.type === 'task.create') return `Created ${quoteTask(decider.state, taskId)}`;
  const describe = DESCRIPTIONS[command.type] as Describe<typeof command.type>;
  return describe(decider.state, command);
}

export function recordOnBehalfAction(decider: Decider, command: ShinsaCommand) {
  if (decider.events.length === 0 || !isUserCommand(command)) return;
  const taskId = selectActionTask(decider, command);
  decider.emit({
    type: 'on_behalf.acted',
    command: command.type,
    taskId,
    summary: describeAction(decider, command, taskId),
    ...(decider.context.byTask ? { byTaskId: decider.context.byTask } : {}),
  });
}
