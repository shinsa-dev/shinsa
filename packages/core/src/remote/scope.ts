import { splitMessageAttachments } from '../chat/attachments.ts';
import type { UserCommand } from '../commands/index.ts';
import type { Gate, GateType, Run, RunAccount, Task, TaskGuest } from '../domain/index.ts';
import { resolveEngineInfo } from '../protocol/engine.ts';
import { resolveStatePatch, type StatePatch } from '../protocol/patch.ts';
import { hasScope } from '../scopes/index.ts';
import type { AccessScopes, ActionScope } from '../scopes/schema.ts';
import { isTeamTask } from '../share/teams.ts';
import type { StateChanges } from '../state/draft.ts';
import { createState, type ShinsaState } from '../state/project.ts';
import { OWNER_ONLY_MESSAGE } from './local-only.ts';

type CommandScope = Exclude<ActionScope, 'services' | 'fork'>;

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

export const TEAM_COMMANDS = [
  'task.give_back',
  'task.share',
  'task.unshare',
  'preview.share',
  'preview.unshare',
] as const satisfies readonly UserCommand['type'][];

type ScopedCommand = Extract<
  UserCommand,
  { type: (typeof SCOPED_COMMANDS)[number] | (typeof TEAM_COMMANDS)[number] }
>;

export type ActorScope =
  | { kind: 'task'; taskId: string }
  | { kind: 'team'; teamId: string; scopes: AccessScopes };

export interface ScopedActor extends TaskGuest {
  scope: ActorScope;
}

const TASK_SCOPE_COMMANDS: ReadonlySet<string> = new Set(SCOPED_COMMANDS);

const TEAM_SCOPE_COMMANDS: ReadonlySet<string> = new Set([...SCOPED_COMMANDS, ...TEAM_COMMANDS]);

const MESSAGE_COMMANDS: ReadonlySet<string> = new Set<ScopedCommand['type']>([
  'task.message',
  'round.update',
  'round.send',
  'suggestion.keep',
]);

const GATE_COMMANDS: ReadonlySet<string> = new Set<ScopedCommand['type']>(['gate.answer', 'merge_step.tick']);

const SHARE_COMMANDS: ReadonlySet<string> = new Set<ScopedCommand['type']>([
  'task.share',
  'task.unshare',
  'preview.share',
  'preview.unshare',
]);

const KEYBOARD_GATES: ReadonlySet<GateType> = new Set<GateType>(['secret', 'sign_in']);

export const SCOPE_REFUSAL_CODE = 'handoff_scope';

export const SCOPE_MESSAGES = {
  command: 'This stays with the owner of the task. You were handed one task to work on.',
  task: 'You can only work on the task that was handed to you.',
  gate: 'Only the owner of the task can answer this, on their machine.',
  attachments: 'Only the owner of the task can attach files to it.',
} as const;

export const TEAM_SCOPE_MESSAGES = {
  command: 'This stays with the owner of the machine. Teammates work on the tasks of the team’s projects.',
  task: 'This task is not in a project your team sees.',
  gates: 'Your team’s owner has not let you answer this task’s gates.',
  actions: 'Your team’s owner has not let you act on tasks.',
  share: 'Your team’s owner has not let you share tasks.',
  message: 'Your team’s owner has not let you message agents. Ask them to hand you the task.',
} as const;

function isScopeCommand(scope: ActorScope, type: string) {
  return (scope.kind === 'task' ? TASK_SCOPE_COMMANDS : TEAM_SCOPE_COMMANDS).has(type);
}

function isScopedCommand(scope: ActorScope, command: UserCommand): command is ScopedCommand {
  return isScopeCommand(scope, command.type);
}

function resolveCommandTask(state: ShinsaState, command: ScopedCommand) {
  if ('taskId' in command) return command.taskId;
  if ('runId' in command) return state.runs[command.runId]?.taskId ?? null;
  return state.gates[command.gateId]?.taskId ?? null;
}

function resolveWrittenText(command: ScopedCommand) {
  if (command.type === 'task.message') return command.text;
  if (command.type === 'round.update') return command.request;
  return '';
}

export function isTaskInScope(state: ShinsaState, scope: ActorScope, taskId: string | null) {
  if (!taskId) return false;
  if (scope.kind === 'task') return taskId === scope.taskId;
  const task = state.tasks[taskId];
  return task ? isTeamTask(state, task, scope.teamId) : false;
}

export function isHeldBy(task: Task | undefined, actor: Pick<ScopedActor, 'id'>) {
  return task?.handoff?.teamId != null && task.handoff.guest?.id === actor.id;
}

export function resolveCommandScope(type: string): CommandScope {
  if (SHARE_COMMANDS.has(type)) return 'share';
  if (MESSAGE_COMMANDS.has(type)) return 'message';
  if (GATE_COMMANDS.has(type)) return 'gates';
  return 'actions';
}

function resolveTeamRefusal(
  state: ShinsaState,
  actor: ScopedActor,
  scopes: AccessScopes,
  command: ScopedCommand,
  taskId: string
) {
  if (command.type === 'task.give_back') return null;
  const scope = resolveCommandScope(command.type);
  const held = scope !== 'share' && isHeldBy(state.tasks[taskId], actor);
  return hasScope(scopes, scope) || held ? null : TEAM_SCOPE_MESSAGES[scope];
}

export function resolveScopedRefusal(state: ShinsaState, actor: ScopedActor, command: UserCommand) {
  const { scope } = actor;
  const messages = scope.kind === 'task' ? SCOPE_MESSAGES : TEAM_SCOPE_MESSAGES;
  if (!isScopedCommand(scope, command)) return messages.command;
  const taskId = resolveCommandTask(state, command);
  if (!taskId || !isTaskInScope(state, scope, taskId)) return messages.task;
  if (command.type === 'task.retry' && command.account) return OWNER_ONLY_MESSAGE;
  if (splitMessageAttachments(resolveWrittenText(command)).attachments.length > 0)
    return SCOPE_MESSAGES.attachments;
  const gate = command.type === 'gate.answer' ? state.gates[command.gateId] : undefined;
  if (gate && KEYBOARD_GATES.has(gate.type)) return SCOPE_MESSAGES.gate;
  return scope.kind === 'team' ? resolveTeamRefusal(state, actor, scope.scopes, command, taskId) : null;
}

function redactAccount<T extends RunAccount | null | undefined>(account: T): T {
  return (account ? { id: account.id, email: null } : account) as T;
}

function seesShares(scope: ActorScope) {
  return scope.kind === 'team' && hasScope(scope.scopes, 'share');
}

function redactShares(task: Task, scope: ActorScope): Task {
  if (seesShares(scope)) return task;
  const { share: _share, previews: _previews, ...rest } = task;
  return rest;
}

function redactTaskAccounts(task: Task, scope: ActorScope): Task {
  const { account, usageWait, handoff, ...rest } = redactShares(task, scope);
  return {
    ...rest,
    ...(account === undefined ? {} : { account: redactAccount(account) }),
    ...(usageWait ? { usageWait: { ...usageWait, account: redactAccount(usageWait.account) } } : {}),
    ...(handoff ? { handoff: { ...handoff, url: null } } : {}),
  };
}

function redactRunAccounts(run: Run): Run {
  return {
    ...run,
    ...(run.account === undefined ? {} : { account: redactAccount(run.account) }),
    ...(run.attempts
      ? { attempts: run.attempts.map((attempt) => ({ ...attempt, account: redactAccount(attempt.account) })) }
      : {}),
    ...(run.failure ? { failure: { ...run.failure, account: redactAccount(run.failure.account) } } : {}),
  };
}

function redactGateAccount(gate: Gate): Gate {
  return gate.account === undefined ? gate : { ...gate, account: redactAccount(gate.account) };
}

function pickRecords<T extends { taskId: string }>(records: Record<string, T>, taskIds: ReadonlySet<string>) {
  return Object.fromEntries(Object.entries(records).filter(([, record]) => taskIds.has(record.taskId)));
}

function pickById<T extends { id: string }>(
  records: Record<string, T>,
  ids: Iterable<string | null | undefined>
) {
  const picked: Record<string, T> = {};
  for (const id of ids) {
    const record = id ? records[id] : undefined;
    if (record) picked[record.id] = record;
  }
  return picked;
}

export function listScopedTasks(state: ShinsaState, scope: ActorScope) {
  if (scope.kind === 'task') {
    const task = state.tasks[scope.taskId];
    return task ? [task] : [];
  }
  return Object.values(state.tasks).filter((task) => isTeamTask(state, task, scope.teamId));
}

function mapRecords<T>(records: Record<string, T>, redact: (record: T) => T) {
  return Object.fromEntries(Object.entries(records).map(([id, record]) => [id, redact(record)]));
}

export function resolveScopedState(state: ShinsaState, scope: ActorScope): ShinsaState {
  const tasks = listScopedTasks(state, scope);
  const taskIds = new Set(tasks.map((task) => task.id));
  return {
    ...createState(),
    seq: state.seq,
    tasks: Object.fromEntries(tasks.map((task) => [task.id, redactTaskAccounts(task, scope)])),
    runs: mapRecords(pickRecords(state.runs, taskIds), redactRunAccounts),
    gates: mapRecords(pickRecords(state.gates, taskIds), redactGateAccount),
    evidence: pickRecords(state.evidence, taskIds),
    repos: pickById(
      state.repos,
      tasks.map((task) => task.repoId)
    ),
    projects: pickById(
      state.projects,
      tasks.map((task) => task.projectId)
    ),
  };
}

export function resolveScopedPatch(
  previous: ShinsaState,
  next: ShinsaState,
  changes: StateChanges,
  scope: ActorScope
): StatePatch {
  const scoped = resolveStatePatch(
    resolveScopedState(previous, scope),
    resolveScopedState(next, scope),
    changes
  );
  return { ...scoped, fields: {} };
}

function isAnnounced(scope: ActorScope, command: string) {
  if (!isScopeCommand(scope, command)) return false;
  if (scope.kind === 'task') return true;
  return SHARE_COMMANDS.has(command) ? hasScope(scope.scopes, 'share') : true;
}

export function resolveScopedEngineInfo(version: string, scope: ActorScope) {
  const info = resolveEngineInfo(version);
  return { ...info, commands: info.commands.filter((command) => isAnnounced(scope, command)) };
}
