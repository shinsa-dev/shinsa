import { type CommandOf, isUserCommand, type ShinsaCommand, type UserCommand } from '../commands/index.ts';
import type { ShinsaState } from '../state/project.ts';
import { listOpenGates } from '../state/queries.ts';
import type { Decider } from './decider.ts';

type HumanOnlyType =
  | 'gate.answer'
  | 'merge_step.tick'
  | 'memory.write'
  | 'memory.accept'
  | 'memory.remove'
  | 'feedback.file'
  | 'watch_suggestion.accept'
  | 'task.share'
  | 'task.unshare'
  | 'preview.share'
  | 'preview.unshare';

const HUMAN_ONLY_TYPES: ReadonlySet<string> = new Set<HumanOnlyType>([
  'gate.answer',
  'merge_step.tick',
  'memory.write',
  'memory.accept',
  'memory.remove',
  'feedback.file',
  'watch_suggestion.accept',
  'task.share',
  'task.unshare',
  'preview.share',
  'preview.unshare',
]);

type OnBehalfCommand = Exclude<UserCommand, { type: HumanOnlyType }>;

type Describe<T extends OnBehalfCommand['type']> = (state: ShinsaState, command: CommandOf<T>) => string;

function describeScheduleWrite(command: CommandOf<'schedule.write'>) {
  if (command.scheduleId) return 'Changed a schedule';
  if (command.source) return `Suggested the watch “${command.name ?? 'Watch'}”`;
  return `Saved the schedule “${command.name ?? 'Schedule'}”`;
}

type Descriptions = { [T in Exclude<OnBehalfCommand['type'], 'task.create'>]: Describe<T> };

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
  'task.move_to_backlog': (state, command) => `Moved ${quoteTask(state, command.taskId)} to the backlog`,
  'task.remove_from_backlog': (state, command) =>
    `Moved ${quoteTask(state, command.taskId)} out of the backlog`,
  'task.snooze': (state, command) => `Snoozed ${quoteTask(state, command.taskId)}`,
  'task.unsnooze': (state, command) => `Unsnoozed ${quoteTask(state, command.taskId)}`,
  'task.cancel': (state, command) => `Cancelled ${quoteTask(state, command.taskId)}`,
  'task.mark_duplicate': (state, command) =>
    `Closed ${quoteTask(state, command.taskId)} as a duplicate of ${quoteTask(state, command.duplicateOf)}`,
  'task.clear_duplicate': (state, command) =>
    `Started ${quoteTask(state, command.taskId)} again, as not a duplicate`,
  'task.complete': (state, command) => `Marked ${quoteTask(state, command.taskId)} as done`,
  'task.retry': (state, command) => `Retried ${quoteTask(state, command.taskId)}`,
  'task.message': (state, command) =>
    listOpenGates(state, command.taskId).length > 0
      ? `Left a message for the next agent on ${quoteTask(state, command.taskId)}, which waits for you`
      : `Messaged ${quoteTask(state, command.taskId)}`,
  'round.ship': (state, command) =>
    command.shipping === 'stacked'
      ? `Set round ${command.number} of ${quoteTask(state, command.taskId)} to ship as its own stacked pull request`
      : `Set round ${command.number} of ${quoteTask(state, command.taskId)} to ship onto the open pull request`,
  'round.update': (state, command) =>
    `Changed queued round ${command.number} of ${quoteTask(state, command.taskId)}`,
  'round.remove': (state, command) =>
    `Removed queued round ${command.number} of ${quoteTask(state, command.taskId)}`,
  'round.send': (state, command) =>
    `Sent queued round ${command.number} of ${quoteTask(state, command.taskId)} to its current round`,
  'suggestion.keep': (state, command) => `Kept a split-off in ${quoteTask(state, command.taskId)}`,
  'monitor.check_in_now': (state, command) =>
    `Checked now what ${quoteTask(state, command.taskId)} waits for`,
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
  'delegation.cancel': (state, command) => `Stopped a delegation on ${quoteRunTask(state, command.runId)}`,
  'suggestion.accept': (state, command) => `Added a suggested task of ${quoteTask(state, command.taskId)}`,
  'suggestion.dismiss': (state, command) =>
    `Dismissed a suggested task of ${quoteTask(state, command.taskId)}`,
  'task.bind_account': (state, command) =>
    command.account
      ? `Set ${quoteTask(state, command.taskId)} to run on ${command.account.email ?? command.account.id}`
      : `Let ${quoteTask(state, command.taskId)} run on any account`,
  'schedule.enable': (state, command) =>
    `${command.enabled ? 'Resumed' : 'Paused'} the schedule ${quoteSchedule(state, command.scheduleId)}`,
  'schedule.remove': () => 'Deleted a schedule',
  'schedule.write': (_state, command) => describeScheduleWrite(command),
  'watch_suggestion.dismiss': (state, command) =>
    `Dismissed the suggested watch “${state.watchSuggestions[command.suggestionId]?.name ?? 'Watch'}”`,
  'watchdog.stop': (state, command) => `Stopped a watchdog of ${quoteTask(state, command.taskId)}`,
  'watchdog.connect': (state, command) =>
    `Connected ${command.server} to a watchdog of ${quoteTask(state, command.taskId)}`,
  'watch_source.write': (state, command) =>
    `Saved ${command.server} as a data source of ${state.projects[command.projectId]?.name ?? 'a project'}`,
  'feedback.write': (_state, command) =>
    command.feedbackId ? 'Rewrote a note of feedback on Shinsa' : 'Wrote feedback on Shinsa',
  'feedback.update': () => 'Changed a feedback issue that waits for you',
  'feedback.dismiss': () => 'Dismissed feedback on Shinsa',
  'watch_source.remove': (state, command) =>
    `Removed ${command.server} from the data sources of ${state.projects[command.projectId]?.name ?? 'a project'}`,
};

function selectCreatedTask(decider: Decider) {
  for (const event of decider.events) if (event.type === 'task.created') return event.taskId;
  return null;
}

function isOnBehalfCommand(command: ShinsaCommand): command is OnBehalfCommand {
  return isUserCommand(command) && !HUMAN_ONLY_TYPES.has(command.type);
}

function selectActionTask(decider: Decider, command: OnBehalfCommand) {
  if ('taskId' in command) return command.taskId;
  if ('runId' in command) return decider.state.runs[command.runId]?.taskId ?? null;
  return selectCreatedTask(decider);
}

function describeAction(decider: Decider, command: OnBehalfCommand, taskId: string | null) {
  if (command.type === 'task.create') return `Created ${quoteTask(decider.state, taskId)}`;
  const describe = DESCRIPTIONS[command.type] as Describe<typeof command.type>;
  return describe(decider.state, command);
}

export function recordOnBehalfAction(decider: Decider, command: ShinsaCommand) {
  if (decider.events.length === 0 || !isOnBehalfCommand(command)) return;
  const taskId = selectActionTask(decider, command);
  decider.emit({
    type: 'on_behalf.acted',
    command: command.type,
    taskId,
    summary: describeAction(decider, command, taskId),
    ...(decider.context.byTask ? { byTaskId: decider.context.byTask } : {}),
  });
}
