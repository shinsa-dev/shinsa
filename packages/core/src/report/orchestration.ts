import {
  DELEGATE_ROLES,
  DELEGATION_LIMITS,
  type DelegateRole,
  type DelegationIsolation,
  type DelegationMode,
} from '../domain/index.ts';
import {
  Flag,
  HandOverReader,
  HandOverRecord,
  Items,
  OptionalText,
  OrAbsent,
  CountUpTo,
  OneOf,
  Required,
  type Validation,
} from './reading.ts';
import { PROTOCOL_LIMITS } from './validate.ts';

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

const RequestKey = OptionalText(DELEGATION_LIMITS.requestKey);

const DelegationRequestInput = HandOverRecord({
  brief: Required(DELEGATION_LIMITS.brief),
  title: OptionalText(DELEGATION_LIMITS.title),
  role: OrAbsent(OneOf(ROLES)),
  mode: OrAbsent(OneOf(DELEGATION_MODES)),
  isolation: OrAbsent(OneOf(DELEGATION_ISOLATIONS)),
  timeout_minutes: OrAbsent(CountUpTo(DELEGATION_LIMITS.maxWaitMinutes)),
  client_request_id: RequestKey,
  provider: OptionalText(DELEGATION_LIMITS.name),
  model: OptionalText(DELEGATION_LIMITS.name),
});

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

const DelegationId = Required(DELEGATION_LIMITS.name);

export function validateDelegationReference(input: Record<string, unknown>): Validation<DelegationReference> {
  const reader = new HandOverReader();
  return reader.result({ delegationId: reader.read(DelegationId, input.delegation_id, ['delegation_id']) });
}

const DelegationAnswerInput = HandOverRecord({
  delegation_id: DelegationId,
  answer: Required(DELEGATION_LIMITS.answer),
});

export function validateDelegationAnswer(
  input: Record<string, unknown>
): Validation<DelegationReference & { answer: string }> {
  const reader = new HandOverReader();
  const { delegation_id: delegationId, answer } = reader.read(DelegationAnswerInput, input, []);
  return reader.result({ delegationId, answer });
}

const CourierTaskInput = HandOverRecord({
  request: Required(PROTOCOL_LIMITS.suggestionRequest),
  client_request_id: RequestKey,
  repository: OptionalText(DELEGATION_LIMITS.name),
  fork_from: OptionalText(DELEGATION_LIMITS.name),
  this_task_waits: Flag,
  after_this: Flag,
  stack_on_this: Flag,
  backlog: Flag,
});

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

const SplitInput = HandOverRecord({
  tasks: Items(
    HandOverRecord({ request: Required(PROTOCOL_LIMITS.suggestionRequest) }),
    DELEGATION_LIMITS.splitTasks,
    1
  ),
  this_task_waits: Flag,
});

export function validateSplit(input: Record<string, unknown>): Validation<SplitRequest> {
  const reader = new HandOverReader();
  const split = reader.read(SplitInput, input, []);
  return reader.result({
    requests: split.tasks.map((task) => task.request),
    thisTaskWaits: split.this_task_waits,
  });
}
