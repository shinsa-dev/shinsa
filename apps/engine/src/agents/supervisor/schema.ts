import type { ChatNotice, DomainError, Repo, Run } from '@shinsa/core';
import { Duration, Effect, type Fiber, type FiberSet, type Ref, Schedule, Schema, type Scope } from 'effect';
import type { ServerConfig } from '../../config/index.ts';
import type { SessionExtensionSource } from '../../extensions/index.ts';
import type { ProcessTracker } from '../../resources/index.ts';
import type { Engine } from '../../runtime/engine.ts';
import type { EvidenceStore } from '../../store/index.ts';
import type { Workspaces } from '../../workspaces/index.ts';
import type { RejectionHandler } from '../accounts.ts';
import type { AccountBroker } from '../accounts.ts';
import type { ActiveRun } from '../active/schema.ts';
import type { ClockTimers } from '../clock.ts';
import type { IdleCompaction } from '../compaction.ts';
import type { IdleCompactionOptions } from '../compaction.ts';
import type { Delivery } from '../delegations/schema.ts';
import type { Deliveries } from '../deliveries/service.ts';
import type { SessionExtensionSets } from '../extension-sets.ts';
import type { IdleReleaseOptions } from '../idle.ts';
import type { ManageAccess } from '../manage/index.ts';
import type { AgentProvider, AgentSessionResult, SessionStarter } from '../providers/index.ts';
import type { ProviderRegistry } from '../providers/index.ts';
import type { Questions } from '../questions.ts';
import type { TaskServiceRunner } from '../services.ts';
import type { ScheduleToolHandler } from '../tool-calls/schema.ts';
import type { ToolCalls } from '../tool-calls/service.ts';
import type { Transcripts } from '../transcripts/index.ts';
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

export type NoticeListener = (runId: string, notice: ChatNotice) => void;

export interface RunControl {
  readonly shuttingDown: boolean;
  readonly holding: (() => void) | null;
  readonly held: ReadonlySet<string>;
}

export const OPEN_CONTROL: RunControl = { shuttingDown: false, holding: null, held: new Set() };

interface RunLimits {
  readonly maxRunMs: number;
  readonly clockTimers: ClockTimers | undefined;
  readonly quiesceMs: number;
  readonly stopMs: number;
}

interface RunHooks {
  readonly startSession: SessionStarter | null;
  readonly onRejection: RejectionHandler | null;
  readonly onNotice: NoticeListener | null;
  readonly trackProcess: ProcessTracker | null;
  readonly extensions: SessionExtensionSource | null;
  readonly manages: boolean;
}

export interface RunParts {
  readonly active: Map<string, ActiveRun>;
  readonly questions: Questions;
  readonly deliveries: Deliveries;
  readonly compaction: IdleCompaction;
  readonly tools: ToolCalls;
  readonly extensionSets: SessionExtensionSets;
  readonly evidence: EvidenceStore;
  readonly limits: RunLimits;
  readonly hooks: RunHooks;
}

export interface RunHostShape extends RunParts {
  readonly scopes: TaskScopesHandle;
  readonly control: Ref.Ref<RunControl>;
  readonly fibers: FiberSet.FiberSet<void, unknown>;
}

export const DRIVE_TIMED_OUT = 'It ran past its time limit without handing over.';

export const NO_WORKTREE = 'The task has no worktree to run in.';

export const COMPACT_ONLY = 'This turn only compacts. End it.';

export class ExtensionsUnavailable extends Schema.TaggedError<
  ExtensionsUnavailable,
  { readonly brand: unique symbol }
>()('ExtensionsUnavailable', { message: Schema.String }) {}

export class SessionStopFailed extends Schema.TaggedError<
  SessionStopFailed,
  { readonly brand: unique symbol }
>()('SessionStopFailed', { message: Schema.String }) {}

export class EditsNotSetAside extends Schema.TaggedError<
  EditsNotSetAside,
  { readonly brand: unique symbol }
>()('EditsNotSetAside', { message: Schema.String }) {}

export class ImageNotKept extends Schema.TaggedError<ImageNotKept, { readonly brand: unique symbol }>()(
  'ImageNotKept',
  { message: Schema.String }
) {}

export interface SupervisorOptions {
  providers?: ProviderRegistry;
  startSession?: SessionStarter;
  maxRunMs?: number;
  clockTimers?: ClockTimers;
  quiesceMs?: number;
  stopMs?: number;
  onRejection?: RejectionHandler;
  onNotice?: NoticeListener;
  accounts?: AccountBroker;
  minuteMs?: number;
  schedules?: ScheduleToolHandler;
  idle?: IdleReleaseOptions;
  compaction?: IdleCompactionOptions;
  extensions?: SessionExtensionSource;
  manage?: ManageAccess;
  workspaces?: Workspaces;
  services?: TaskServiceRunner;
  trackProcess?: ProcessTracker;
}

export interface SupervisorInput {
  readonly engine: Engine;
  readonly config: ServerConfig;
  readonly transcripts: Transcripts;
  readonly evidence: EvidenceStore;
  readonly workspaces: Workspaces;
  readonly options: SupervisorOptions;
}

export interface RunSupervisorShape {
  readonly execute: (
    runId: string,
    override: string | null,
    delivery: Delivery | null
  ) => Effect.Effect<void, DomainError | RunDispatchFailed | WorkspaceUnavailable>;
  readonly quiesce: (taskId: string, except?: string) => Effect.Effect<void>;
  readonly steer: (
    runId: string,
    text: string,
    cause?: string,
    from?: 'shinsa'
  ) => Effect.Effect<void, DomainError | RunDispatchFailed | WorkspaceUnavailable>;
  readonly cancel: (runId: string) => Effect.Effect<void>;
  readonly holdNewRuns: (onHeld: () => void) => Effect.Effect<void>;
  readonly releaseHeldRuns: Effect.Effect<void>;
  readonly isHeld: (runId: string) => Effect.Effect<boolean>;
  readonly interruptForShutdown: Effect.Effect<void>;
  readonly recover: Effect.Effect<void, DomainError | RunDispatchFailed>;
  readonly resolveQuestion: (gateId: string) => Effect.Effect<void>;
  readonly replyToDelegate: (runId: string, questionId: string) => Effect.Effect<void>;
  readonly deliver: (runId: string, generation: number) => Effect.Effect<void>;
  readonly wake: (runId: string, generation: number) => Effect.Effect<void>;
}
