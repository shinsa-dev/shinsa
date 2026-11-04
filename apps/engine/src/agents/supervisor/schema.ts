import type { ChatNotice, DomainError, Repo, Run } from '@shinsa/core';
import {
  Context,
  Duration,
  Effect,
  type Fiber,
  type FiberSet,
  type Ref,
  Schedule,
  Schema,
  type Scope,
} from 'effect';
import type { SessionExtensionSource } from '../../extensions/index.ts';
import type { ProcessTracker } from '../../resources/index.ts';
import type { EngineStopped } from '../../runtime/engine/schema.ts';
import type { Evidence } from '../../store/evidence/service.ts';
import type { RejectionHandler } from '../accounts/schema.ts';
import type { ActiveRun } from '../active/schema.ts';
import type { IdleCompaction } from '../compaction/service.ts';
import type { Delivery } from '../delegations/schema.ts';
import type { Deliveries } from '../deliveries/service.ts';
import type { SessionExtensionSets } from '../extension-sets/service.ts';
import type { AgentProvider, AgentSessionResult, SessionStarter } from '../providers/index.ts';
import type { Questions } from '../questions/service.ts';
import type { ToolCalls } from '../tool-calls/service.ts';
import type { TurnPlan } from '../turns/schema.ts';

interface TaskScope {
  readonly scope: Scope.Closeable;
  readonly open: number;
}

export interface RunScope {
  readonly taskId: string;
  readonly parentRunId: string | null;
  readonly scope: Scope.Closeable;
  readonly attempt: Scope.Closeable | null;
  readonly fiber: Ref.Ref<Fiber.Fiber<unknown, unknown> | null>;
}

export interface RunScopeRequest {
  readonly taskId: string;
  readonly runId: string;
  readonly parentRunId: string | null;
  readonly fiber?: Fiber.Fiber<unknown, unknown> | null;
}

export interface ScopeTable {
  readonly tasks: ReadonlyMap<string, TaskScope>;
  readonly runs: ReadonlyMap<string, RunScope>;
}

export interface TaskScopesHandle {
  readonly open: (request: RunScopeRequest) => Effect.Effect<Scope.Closeable>;
  readonly close: (runId: string) => Effect.Effect<void>;
  readonly closeRun: (runId: string) => Effect.Effect<void>;
  readonly closeTask: (taskId: string) => Effect.Effect<void>;
  readonly closeAll: Effect.Effect<void>;
  readonly listTasks: Effect.Effect<readonly string[]>;
}

export interface Workspace {
  readonly cwd: string;
  readonly repo: Repo | null;
  readonly defaultBranch: string;
}

export interface Turn {
  readonly run: Run;
  readonly cwd: string;
  readonly defaultBranch: string;
  readonly prompt: string;
  readonly brief: string;
  readonly stepPrompt: boolean;
  readonly provider: AgentProvider;
  readonly active: ActiveRun;
}

export interface DriveAttempt {
  readonly plan: TurnPlan;
  readonly restored: boolean;
}

export type DriveStep = DriveAttempt | { readonly done: AgentSessionResult };

export interface RecordedAttempt {
  readonly attemptId: string;
  readonly account: { readonly id: string; readonly email: string | null } | null;
}

export class WorkspaceUnavailable extends Schema.TaggedError<
  WorkspaceUnavailable,
  { readonly brand: unique symbol }
>()('WorkspaceUnavailable', { message: Schema.String }) {}

export class IsolationFailed extends Schema.TaggedError<IsolationFailed, { readonly brand: unique symbol }>()(
  'IsolationFailed',
  { message: Schema.String }
) {}

export class LeaseFailed extends Schema.TaggedError<LeaseFailed, { readonly brand: unique symbol }>()(
  'LeaseFailed',
  { message: Schema.String }
) {}

export class RunDispatchFailed extends Schema.TaggedError<
  RunDispatchFailed,
  { readonly brand: unique symbol }
>()('RunDispatchFailed', { message: Schema.String }) {}

export const MAX_RUN_MS = 2 * 60 * 60 * 1000;

export const SCRATCH_BRANCH = 'main';

export const QUIESCE_MS = 60_000;

export const STOP_MS = 15_000;

export const OVERLOAD_RETRIES = 3;

const OVERLOAD_FACTOR = 2;

export interface OverloadRetryInput {
  readonly baseMs: number;
}

export const OVERLOAD_RETRY = Schedule.recurs(OVERLOAD_RETRIES).pipe(
  Schedule.setInputType<OverloadRetryInput>(),
  Schedule.modifyDelay(({ input, attempt }) =>
    Effect.succeed(Duration.millis(input.baseMs * OVERLOAD_FACTOR ** (attempt - 1)))
  )
);

export const UNGUARDED =
  'This agent provider cannot stop the commands Shinsa forbids, so Shinsa will not run it.';

export const UNREADONLY =
  'This agent provider cannot keep a read-only agent from changing files, so Shinsa will not run a read-only task on it.';

export type NoticeListener = (runId: string, notice: ChatNotice) => Effect.Effect<void>;

export interface RunControl {
  readonly shuttingDown: boolean;
  readonly holding: Effect.Effect<void> | null;
  readonly held: ReadonlySet<string>;
}

export const OPEN_CONTROL: RunControl = { shuttingDown: false, holding: null, held: new Set() };

export interface RunLimitsShape {
  readonly maxRunMs: number;
  readonly quiesceMs: number;
  readonly stopMs: number;
}

export const RunLimits = Context.Reference<RunLimitsShape>('shinsa/engine/agents/supervisor/RunLimits', {
  defaultValue: () => ({ maxRunMs: MAX_RUN_MS, quiesceMs: QUIESCE_MS, stopMs: STOP_MS }),
});

export interface RunHooksShape {
  readonly startSession: SessionStarter | null;
  readonly onRejection: RejectionHandler | null;
  readonly onNotice: NoticeListener | null;
}

export const RunHooks = Context.Reference<RunHooksShape>('shinsa/engine/agents/supervisor/RunHooks', {
  defaultValue: () => ({ startSession: null, onRejection: null, onNotice: null }),
});

interface RunSurroundings {
  readonly trackProcess: ProcessTracker | null;
  readonly extensions: SessionExtensionSource | null;
  readonly manages: boolean;
}

export interface RunParts {
  readonly active: Map<string, ActiveRun>;
  readonly questions: Questions['Service'];
  readonly deliveries: Deliveries['Service'];
  readonly compaction: IdleCompaction['Service'];
  readonly tools: ToolCalls['Service'];
  readonly extensionSets: SessionExtensionSets['Service'];
  readonly evidence: Evidence['Service'];
  readonly limits: RunLimitsShape;
  readonly hooks: RunHooksShape & RunSurroundings;
}

export interface RunHostShape extends RunParts {
  readonly scopes: TaskScopesHandle;
  readonly control: Ref.Ref<RunControl>;
  readonly fibers: FiberSet.FiberSet<void, unknown>;
}

export const DRIVE_TIMED_OUT = 'It ran past its time limit without handing over.';

export const NO_RUN_WORKTREE = 'The task has no worktree to run in.';

export const COMPACT_ONLY = 'This turn only compacts. End it.';

export class ExtensionsUnavailable extends Schema.TaggedError<
  ExtensionsUnavailable,
  { readonly brand: unique symbol }
>()('ExtensionsUnavailable', { message: Schema.String }) {}

export class EditsNotSetAside extends Schema.TaggedError<
  EditsNotSetAside,
  { readonly brand: unique symbol }
>()('EditsNotSetAside', { message: Schema.String }) {}

export class ImageNotKept extends Schema.TaggedError<ImageNotKept, { readonly brand: unique symbol }>()(
  'ImageNotKept',
  { message: Schema.String }
) {}

export interface RunSupervisorShape {
  readonly execute: (
    runId: string,
    override: string | null,
    delivery: Delivery | null
  ) => Effect.Effect<void, DomainError | RunDispatchFailed | WorkspaceUnavailable | EngineStopped>;
  readonly quiesce: (taskId: string, except?: string) => Effect.Effect<void>;
  readonly steer: (
    runId: string,
    text: string,
    cause?: string,
    from?: 'shinsa'
  ) => Effect.Effect<void, DomainError | RunDispatchFailed | WorkspaceUnavailable>;
  readonly cancel: (runId: string) => Effect.Effect<void>;
  readonly holdNewRuns: (onHeld: Effect.Effect<void>) => Effect.Effect<void>;
  readonly releaseHeldRuns: Effect.Effect<void>;
  readonly isHeld: (runId: string) => Effect.Effect<boolean>;
  readonly interruptForShutdown: Effect.Effect<void>;
  readonly recover: Effect.Effect<void, DomainError | RunDispatchFailed>;
  readonly resolveQuestion: (gateId: string) => Effect.Effect<void, DomainError | EngineStopped>;
  readonly replyToDelegate: (runId: string, questionId: string) => Effect.Effect<void>;
  readonly deliver: (runId: string, generation: number) => Effect.Effect<void, DomainError | EngineStopped>;
  readonly wake: (runId: string, generation: number) => Effect.Effect<void, DomainError | EngineStopped>;
}
