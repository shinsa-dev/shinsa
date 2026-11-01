import {
  DELEGATE_ROLES,
  DELEGATION_LIMITS,
  type DelegateRole,
  type DelegationIsolation,
  type DelegationMode,
} from '../domain/index.ts';
import { PROTOCOL_LIMITS, Reader, type Validation } from './validate.ts';

const ROLES = DELEGATE_ROLES as readonly [DelegateRole, ...DelegateRole[]];

export const DELEGATION_MODES: readonly [DelegationMode, ...DelegationMode[]] = ['async', 'wait'];

export const DELEGATION_ISOLATIONS: readonly [DelegationIsolation, ...DelegationIsolation[]] = [
  'shared',
  'worktree',
];

export interface DelegationRequest {
  brief: string;
  title: string;
  role: DelegateRole | null;
  mode: DelegationMode;
  isolation: DelegationIsolation;
  timeoutMinutes: number;
  requestKey: string | null;
  provider: string | null;
  model: string | null;
}

export interface DelegationReference {
  delegationId: string;
}

export interface CourierRequest {
  request: string;
  requestKey: string | null;
  repository: string | null;
  forkFrom: string | null;
  thisTaskWaits: boolean;
  afterThis: boolean;
  stackOnThis: boolean;
  backlog: boolean;
}

export interface SplitRequest {
  requests: string[];
  thisTaskWaits: boolean;
}

function resolveTitle(title: string | null, brief: string) {
  if (title) return title;
  const line = brief.split('\n', 1)[0]?.trim() ?? '';
  return line.length > DELEGATION_LIMITS.title ? `${line.slice(0, DELEGATION_LIMITS.title - 1)}…` : line;
}

export function validateDelegationRequest(input: Record<string, unknown>): Validation<DelegationRequest> {
  const reader = new Reader();
  const brief = reader.text(input.brief, 'brief', DELEGATION_LIMITS.brief);
  const title = reader.optionalText(input.title, 'title', DELEGATION_LIMITS.title);
  return reader.result({
    brief,
    title: resolveTitle(title, brief),
    role: input.role === undefined || input.role === null ? null : reader.pick(input.role, 'role', ROLES),
    mode: reader.pick(input.mode ?? 'async', 'mode', DELEGATION_MODES),
    isolation: reader.pick(input.isolation ?? 'shared', 'isolation', DELEGATION_ISOLATIONS),
    timeoutMinutes:
      reader.optionalCount(input.timeout_minutes, 'timeout_minutes', DELEGATION_LIMITS.maxWaitMinutes) ??
      DELEGATION_LIMITS.waitMinutes,
    requestKey: reader.optionalText(
      input.client_request_id,
      'client_request_id',
      DELEGATION_LIMITS.requestKey
    ),
    provider: reader.optionalText(input.provider, 'provider', DELEGATION_LIMITS.name),
    model: reader.optionalText(input.model, 'model', DELEGATION_LIMITS.name),
  });
}

export function validateDelegationReference(input: Record<string, unknown>): Validation<DelegationReference> {
  const reader = new Reader();
  return reader.result({
    delegationId: reader.text(input.delegation_id, 'delegation_id', DELEGATION_LIMITS.name),
  });
}

export function validateDelegationAnswer(
  input: Record<string, unknown>
): Validation<DelegationReference & { answer: string }> {
  const reader = new Reader();
  return reader.result({
    delegationId: reader.text(input.delegation_id, 'delegation_id', DELEGATION_LIMITS.name),
    answer: reader.text(input.answer, 'answer', DELEGATION_LIMITS.answer),
  });
}

export function validateCourierTask(input: Record<string, unknown>): Validation<CourierRequest> {
  const reader = new Reader();
  return reader.result({
    request: reader.text(input.request, 'request', PROTOCOL_LIMITS.suggestionRequest),
    requestKey: reader.optionalText(
      input.client_request_id,
      'client_request_id',
      DELEGATION_LIMITS.requestKey
    ),
    repository: reader.optionalText(input.repository, 'repository', DELEGATION_LIMITS.name),
    forkFrom: reader.optionalText(input.fork_from, 'fork_from', DELEGATION_LIMITS.name),
    thisTaskWaits: reader.flag(input.this_task_waits, 'this_task_waits'),
    afterThis: reader.flag(input.after_this, 'after_this'),
    stackOnThis: reader.flag(input.stack_on_this, 'stack_on_this'),
    backlog: reader.flag(input.backlog, 'backlog'),
  });
}

export function validateSplit(input: Record<string, unknown>): Validation<SplitRequest> {
  const reader = new Reader();
  const requests = reader.list(input.tasks, 'tasks', DELEGATION_LIMITS.splitTasks, 1).map((raw, index) => {
    const record = reader.record(raw, `tasks[${index}]`);
    return reader.text(record.request, `tasks[${index}].request`, PROTOCOL_LIMITS.suggestionRequest);
  });
  return reader.result({ requests, thisTaskWaits: reader.flag(input.this_task_waits, 'this_task_waits') });
}
