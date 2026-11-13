import { type ChatNotice, DomainError, type TeamFeedTask } from '@shinsa/core';
import { Clock, Context, Duration, Effect, Layer, Scope } from 'effect';
import type { Accounts } from '../../../src/accounts/index.ts';
import {
  AccountBroker,
  AccountBrokerFailed,
  type AccountLease,
  type AccountLeaseRequest,
  type RejectionVerdict,
  type RunRejection,
} from '../../../src/agents/accounts/schema.ts';
import { RunClockTime } from '../../../src/agents/clock/schema.ts';
import type { Delivery } from '../../../src/agents/delegations/schema.ts';
import { IDLE_RELEASE, IdleReleaseSettings, MAX_IDLE_PIN_MS } from '../../../src/agents/idle/schema.ts';
import { ManageAccess } from '../../../src/agents/manage/index.ts';
import type { AgentSessionInput, SessionStarter } from '../../../src/agents/providers/index.ts';
import { ProvidersLayer } from '../../../src/agents/providers/layers.ts';
import { Providers } from '../../../src/agents/providers/registry/service.ts';
import { RunSupervisorLayer } from '../../../src/agents/supervisor/layers.ts';
import {
  RunHooks,
  RunLimits,
  MAX_RUN_MS,
  QUIESCE_MS,
  STOP_MS,
} from '../../../src/agents/supervisor/schema.ts';
import { RunSupervisor } from '../../../src/agents/supervisor/service.ts';
import { DelegationMinute, TeammateTasks } from '../../../src/agents/tool-calls/schema.ts';
import type { Transcripts } from '../../../src/agents/transcripts/service.ts';
import { Transcripts as TranscriptsService } from '../../../src/agents/transcripts/service.ts';
import { BrowserSignInCheck } from '../../../src/browser/check/service.ts';
import { BrowserProxy } from '../../../src/browser/proxy/service.ts';
import type { ServerConfig } from '../../../src/config/index.ts';
import { EngineConfig } from '../../../src/config/service.ts';
import { ConfigStore } from '../../../src/config/store/service.ts';
import type { SessionExtensionSource } from '../../../src/extensions/index.ts';
import { Extensions } from '../../../src/extensions/registry/service.ts';
import { GitLayer } from '../../../src/git/layers.ts';
import { JsonLogger } from '../../../src/log/service.ts';
import { StandaloneRepoWorkLayer } from '../../../src/repos/layers.ts';
import { ProcessLedger, type ProcessTracker } from '../../../src/resources/index.ts';
import { EngineCore } from '../../../src/runtime/engine/service.ts';
import type { ScheduleToolFailure, ScheduleToolRun } from '../../../src/schedules/tools/schema.ts';
import { ScheduleTools } from '../../../src/schedules/tools/service.ts';
import { ShellLayer } from '../../../src/shell/layers.ts';
import type { Evidence } from '../../../src/store/evidence/service.ts';
import { Evidence as EvidenceService } from '../../../src/store/evidence/service.ts';
import { Terminals } from '../../../src/terminals/index.ts';
import { WorkspacesServiceLayer } from '../../../src/workspaces/layers.ts';
import { WorktreeRoot } from '../../../src/workspaces/root/service.ts';
import { Workspaces } from '../../../src/workspaces/service.ts';
import type { Engine } from '../../helpers/engine.ts';
import { JsonFileLayer } from '../../helpers/files.ts';

interface ClockTimers {
  now: () => number;
  start: (fire: () => void, ms: number) => unknown;
  clear: (timer: unknown) => void;
}

interface PromiseBroker {
  lease: (request: AccountLeaseRequest) => Promise<AccountLease | null>;
  readWeeklyReading: (
    accountId: string,
    force: boolean
  ) => Promise<import('@shinsa/core').WeeklyReading | null>;
  readProviderWeeklyReading: (
    provider: string,
    force: boolean
  ) => Promise<import('@shinsa/core').WeeklyReading | null>;
  readFastMode: (
    provider: string,
    accountId: string | null
  ) => Promise<import('@shinsa/core').FastModeAvailability>;
  machineOwner?: string | null;
}

export interface SupervisorOptions {
  providers?: Providers['Service'];
  startSession?: SessionStarter;
  maxRunMs?: number;
  clockTimers?: ClockTimers;
  quiesceMs?: number;
  stopMs?: number;
  onRejection?: (rejection: RunRejection) => Promise<RejectionVerdict> | RejectionVerdict;
  onNotice?: (runId: string, notice: ChatNotice) => void;
  accounts?: PromiseBroker;
  accountRoster?: Accounts['Service'];
  minuteMs?: number;
  schedules?: {
    handleTool: (
      name: string,
      input: Record<string, unknown>,
      call: ScheduleToolRun
    ) => Promise<string> | Effect.Effect<string, ScheduleToolFailure> | null;
  };
  idle?: { idleMs?: number; maxPinMs?: number };
  compaction?: { now?: () => number };
  extensions?: Partial<SessionExtensionSource>;
  manage?: ManageAccess['Service'];
  workspaces?: Workspaces['Service'];
  services?: unknown;
  trackProcess?: ProcessTracker;
  browser?: Pick<BrowserProxy['Service'], 'issue'>;
  signInCheck?: BrowserSignInCheck['Service'];
  teamTasks?: () => readonly TeamFeedTask[];
}

function resolveTimersClock(timers: ClockTimers): Clock.Clock {
  const nanos = () => BigInt(timers.now()) * 1_000_000n;
  return {
    currentTimeMillisUnsafe: timers.now,
    currentTimeMillis: Effect.sync(timers.now),
    currentTimeNanosUnsafe: nanos,
    currentTimeNanos: Effect.sync(nanos),
    monotonicTimeNanosUnsafe: nanos,
    monotonicTimeNanos: Effect.sync(nanos),
    sleep: (duration) =>
      Effect.callback<void>((resume) => {
        const timer = timers.start(() => resume(Effect.void), Duration.toMillis(duration));
        return Effect.sync(() => timers.clear(timer));
      }),
  };
}

const SYSTEM_TIMERS = {
  start: (fire: () => void, ms: number) => setTimeout(fire, ms),
  clear: (timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

function failBroker(error: unknown) {
  return new AccountBrokerFailed({ message: error instanceof Error ? error.message : String(error) });
}

function resolveBroker(options: SupervisorOptions) {
  const { accounts, accountRoster } = options;
  if (accounts) {
    return Layer.succeed(AccountBroker, {
      lease: (request) =>
        Effect.tryPromise({
          try: () => accounts.lease(request),
          catch: (error) => (error instanceof DomainError ? error : failBroker(error)),
        }),
      readWeeklyReading: (accountId, force) =>
        Effect.tryPromise({ try: () => accounts.readWeeklyReading(accountId, force), catch: failBroker }),
      readProviderWeeklyReading: (provider, force) =>
        Effect.tryPromise({
          try: () => accounts.readProviderWeeklyReading(provider, force),
          catch: failBroker,
        }),
      readFastMode: (provider, accountId) =>
        Effect.tryPromise({ try: () => accounts.readFastMode(provider, accountId), catch: failBroker }),
      ...(accounts.machineOwner === undefined ? {} : { machineOwner: Effect.succeed(accounts.machineOwner) }),
    });
  }
  if (accountRoster) {
    return Layer.succeed(AccountBroker, {
      lease: (request) => accountRoster.lease(request).pipe(Effect.mapError(failBroker)),
      readWeeklyReading: accountRoster.readWeeklyReading,
      readProviderWeeklyReading: accountRoster.readProviderWeeklyReading,
      readFastMode: accountRoster.readFastMode,
    });
  }
  return Layer.empty;
}

function resolveHooks(options: SupervisorOptions) {
  const { onRejection, onNotice, accountRoster } = options;
  if (!options.startSession && !onRejection && !onNotice && !accountRoster) return Layer.empty;
  return Layer.succeed(RunHooks, {
    startSession: options.startSession ?? null,
    onRejection: onRejection
      ? (rejection) => Effect.promise(() => Promise.resolve(onRejection(rejection)))
      : (accountRoster?.onRejection ?? null),
    onNotice: onNotice
      ? (runId, notice) => Effect.sync(() => onNotice(runId, notice))
      : (accountRoster?.onNotice ?? null),
  });
}

function resolveSurroundings(options: SupervisorOptions) {
  const { extensions, trackProcess, schedules, manage, services, browser, signInCheck } = options;
  return Layer.mergeAll(
    browser ? Layer.succeed(BrowserProxy, browser as BrowserProxy['Service']) : Layer.empty,
    signInCheck ? Layer.succeed(BrowserSignInCheck, signInCheck) : Layer.empty,
    extensions ? Layer.succeed(Extensions, extensions as unknown as Extensions['Service']) : Layer.empty,
    trackProcess
      ? Layer.succeed(ProcessLedger, {
          track: trackProcess,
          listRoots: Effect.succeed([]),
        } as unknown as ProcessLedger['Service'])
      : Layer.empty,
    schedules
      ? Layer.succeed(ScheduleTools, {
          handle: (name: string, input: Record<string, unknown>, run: ScheduleToolRun) => {
            const reply = schedules.handleTool(name, input, run);
            if (reply === null || Effect.isEffect(reply)) return reply;
            return Effect.promise(() => reply);
          },
        } as unknown as ScheduleTools['Service'])
      : Layer.empty,
    manage ? Layer.succeed(ManageAccess, manage) : Layer.empty,
    services ? Layer.succeed(Terminals, services as Terminals['Service']) : Layer.empty
  );
}

function resolveTimings(options: SupervisorOptions) {
  const { clockTimers, idle, minuteMs, compaction, teamTasks } = options;
  return Layer.mergeAll(
    teamTasks ? Layer.succeed(TeammateTasks, Effect.sync(teamTasks)) : Layer.empty,
    options.maxRunMs === undefined && options.quiesceMs === undefined && options.stopMs === undefined
      ? Layer.empty
      : Layer.succeed(RunLimits, {
          maxRunMs: options.maxRunMs ?? MAX_RUN_MS,
          quiesceMs: options.quiesceMs ?? QUIESCE_MS,
          stopMs: options.stopMs ?? STOP_MS,
        }),
    clockTimers ? Layer.succeed(RunClockTime, resolveTimersClock(clockTimers)) : Layer.empty,
    idle
      ? Layer.succeed(IdleReleaseSettings, {
          idle: idle.idleMs === undefined ? IDLE_RELEASE : Duration.millis(idle.idleMs),
          maxPinMs: idle.maxPinMs ?? MAX_IDLE_PIN_MS,
        })
      : Layer.empty,
    minuteMs === undefined ? Layer.empty : Layer.succeed(DelegationMinute, Duration.millis(minuteMs)),
    compaction?.now
      ? Layer.succeed(Clock.Clock, resolveTimersClock({ now: compaction.now, ...SYSTEM_TIMERS }))
      : Layer.empty
  );
}

function createSupervisorLayer(
  engine: Pick<Engine, 'core'>,
  config: ServerConfig,
  transcripts: Transcripts['Service'],
  evidence: Evidence['Service'],
  options: SupervisorOptions = {}
) {
  const base = Layer.mergeAll(
    Layer.succeed(EngineCore, engine.core),
    Layer.succeed(EngineConfig, config),
    Layer.succeed(TranscriptsService, transcripts),
    Layer.succeed(EvidenceService, evidence)
  );
  const machine = Layer.merge(base, ConfigStore.layer.pipe(Layer.provide(Layer.merge(base, JsonFileLayer))));
  const workspaces = options.workspaces
    ? Layer.merge(
        Layer.succeed(Workspaces, options.workspaces),
        WorktreeRoot.layer.pipe(Layer.provide(machine), Layer.provide(ShellLayer))
      )
    : WorkspacesServiceLayer.pipe(Layer.provide(machine), Layer.provide(GitLayer), Layer.provide(ShellLayer));
  const providers = options.providers
    ? Layer.succeed(Providers, options.providers)
    : ProvidersLayer.pipe(Layer.provide(ShellLayer));
  return RunSupervisorLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        base,
        workspaces,
        providers,
        StandaloneRepoWorkLayer.pipe(Layer.provide(base)),
        GitLayer.pipe(Layer.provideMerge(ShellLayer)),
        resolveBroker(options),
        resolveHooks(options),
        resolveSurroundings(options),
        resolveTimings(options)
      )
    ),
    Layer.provideMerge(JsonLogger)
  );
}

export interface PromiseSupervisor {
  execute(runId: string, override?: string | null, delivery?: Delivery | null): Promise<void>;
  quiesce(taskId: string, except?: string): Promise<void>;
  steer(runId: string, text: string, cause?: string, from?: 'shinsa'): Promise<void>;
  cancel(runId: string): Promise<void>;
  holdNewRuns(onHeld: () => void): void;
  releaseHeldRuns(): void;
  isHeld(runId: string): boolean;
  interruptForShutdown(): Promise<void>;
  resolveQuestion(gateId: string): Promise<void>;
  replyToDelegate(runId: string, questionId: string): Promise<void>;
  deliver(runId: string, generation: number): Promise<void>;
  wake(runId: string, generation: number): Promise<void>;
  recover(): Promise<void>;
  readonly service: RunSupervisor['Service'];
}

export function createSupervisor(
  engine: Pick<Engine, 'core'>,
  config: ServerConfig,
  transcripts: Transcripts['Service'],
  evidence: Evidence['Service'],
  options: SupervisorOptions = {}
): PromiseSupervisor {
  const layer = createSupervisorLayer(engine, config, transcripts, evidence, options);
  const built = Effect.runSync(
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      return yield* Layer.buildWithScope(layer, scope);
    })
  );
  const service = Context.get(built, RunSupervisor);
  const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.provide(effect, built));
  const runSync = <A, E>(effect: Effect.Effect<A, E>) => Effect.runSync(Effect.provide(effect, built));
  return {
    service,
    execute: (runId, override = null, delivery = null) => run(service.execute(runId, override, delivery)),
    quiesce: (taskId, except) => run(service.quiesce(taskId, except)),
    steer: (runId, text, cause, from) => run(service.steer(runId, text, cause, from)),
    cancel: (runId) => run(service.cancel(runId)),
    holdNewRuns: (onHeld) => runSync(service.holdNewRuns(Effect.sync(onHeld))),
    releaseHeldRuns: () => runSync(service.releaseHeldRuns),
    isHeld: (runId) => runSync(service.isHeld(runId)),
    interruptForShutdown: () => run(service.interruptForShutdown),
    resolveQuestion: (gateId) => run(service.resolveQuestion(gateId)),
    replyToDelegate: (runId, questionId) => run(service.replyToDelegate(runId, questionId)),
    deliver: (runId, generation) => run(service.deliver(runId, generation)),
    wake: (runId, generation) => run(service.wake(runId, generation)),
    recover: () => run(service.recover),
  };
}

type ToolArguments = Parameters<AgentSessionInput['tools']['handle']>;

type PromiseTools = Omit<AgentSessionInput['tools'], 'handle'> & {
  handle: (...args: ToolArguments) => Promise<string>;
};

export type PromiseInput = Omit<AgentSessionInput, 'tools'> & { tools: PromiseTools };

export function adaptInput(input: AgentSessionInput): PromiseInput {
  return {
    ...input,
    tools: {
      ...input.tools,
      handle: (...args: ToolArguments) =>
        Effect.runPromise(input.tools.handle(...args).pipe(Effect.provide(JsonLogger))),
    },
  };
}
