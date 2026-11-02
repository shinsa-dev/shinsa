import {
  type DelegateRole,
  DELEGATION_LIMITS,
  type DelegationIsolation,
  type DelegationMode,
} from '../domain/index.ts';
import { HandOverReader, type Validation } from './reading.ts';
import {
  CourierTaskInput,
  DelegationAnswerInput,
  DelegationId,
  DelegationRequestInput,
  SplitInput,
} from './schema.ts';

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
  const reader = new HandOverReader();
  const request = reader.read(DelegationRequestInput, input, []);
  return reader.result({
    brief: request.brief,
    title: resolveTitle(request.title, request.brief),
    role: request.role,
    mode: request.mode ?? 'async',
    isolation: request.isolation ?? 'shared',
    timeoutMinutes: request.timeout_minutes ?? DELEGATION_LIMITS.waitMinutes,
    requestKey: request.client_request_id,
    provider: request.provider,
    model: request.model,
  });
}

export function validateDelegationReference(input: Record<string, unknown>): Validation<DelegationReference> {
  const reader = new HandOverReader();
  return reader.result({ delegationId: reader.read(DelegationId, input.delegation_id, ['delegation_id']) });
}

export function validateDelegationAnswer(
  input: Record<string, unknown>
): Validation<DelegationReference & { answer: string }> {
  const reader = new HandOverReader();
  const { delegation_id: delegationId, answer } = reader.read(DelegationAnswerInput, input, []);
  return reader.result({ delegationId, answer });
}

export function validateCourierTask(input: Record<string, unknown>): Validation<CourierRequest> {
  const reader = new HandOverReader();
  const task = reader.read(CourierTaskInput, input, []);
  return reader.result({
    request: task.request,
    requestKey: task.client_request_id,
    repository: task.repository,
    forkFrom: task.fork_from,
    thisTaskWaits: task.this_task_waits,
    afterThis: task.after_this,
    stackOnThis: task.stack_on_this,
    backlog: task.backlog,
  });
}

export function validateSplit(input: Record<string, unknown>): Validation<SplitRequest> {
  const reader = new HandOverReader();
  const split = reader.read(SplitInput, input, []);
  return reader.result({
    requests: split.tasks.map((task) => task.request),
    thisTaskWaits: split.this_task_waits,
  });
}
