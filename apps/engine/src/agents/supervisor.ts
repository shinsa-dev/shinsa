import { type ChatEvent, MINUTE_MS } from '@shinsa/core';
import { Layer, ManagedRuntime } from 'effect';
import type { ServerConfig } from '../config/index.ts';
import type { SessionExtensionSource } from '../extensions/index.ts';
import { JsonLogger } from '../log/service.ts';
import type { ProcessTracker } from '../resources/index.ts';
import type { Engine } from '../runtime/engine.ts';
import type { EvidenceStore } from '../store/index.ts';
import { Workspaces } from '../workspaces/index.ts';
import { type AccountBroker, AccountLeasing, type RejectionHandler } from './accounts.ts';
import type { ActiveRun } from './active/schema.ts';
import type { ClockTimers } from './clock.ts';
import { IdleCompaction, type IdleCompactionOptions } from './compaction.ts';
import type { Delivery } from './delegations/schema.ts';
import { Deliveries } from './deliveries/service.ts';
import { SessionExtensionSets } from './extension-sets.ts';
import type { IdleReleaseOptions } from './idle.ts';
import type { ManageAccess } from './manage/index.ts';
import { ProviderRegistry, type SessionStarter } from './providers/index.ts';
import { Questions } from './questions.ts';
import type { TaskServiceRunner } from './services.ts';
import { compactSession } from './supervisor/compact.ts';
import {
  cancelRun,
  recoverRuns,
  releaseHeld,
  runToEnd,
  shutdownRuns,
  steerRun,
} from './supervisor/control.ts';
import { RunHost } from './supervisor/host/service.ts';
import {
  MAX_RUN_MS,
  type NoticeListener,
  QUIESCE_MS,
  type RunControl,
  STOP_MS,
} from './supervisor/schema.ts';
import { listServerNames } from './supervisor/session.ts';
import { quiesceTask } from './supervisor/stop.ts';
import { RunWorld } from './supervisor/world/service.ts';
import type { ScheduleToolHandler } from './tool-calls/schema.ts';
import { ToolCalls } from './tool-calls/service.ts';
import type { Transcripts } from './transcripts/index.ts';

export type { NoticeListener } from './supervisor/schema.ts';

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

export class RunSupervisor {
  readonly #engine: Engine;
  readonly #transcripts: Transcripts;
  readonly #onNotice: NoticeListener | null;
  readonly #control: RunControl = { shuttingDown: false, holding: null, held: new Set() };
  readonly #questions: Questions;
  readonly #deliveries: Deliveries;
  readonly #runtime: ManagedRuntime.ManagedRuntime<RunWorld | RunHost, never>;
  readonly workspaces: Workspaces;

  constructor(
    engine: Engine,
    config: ServerConfig,
    transcripts: Transcripts,
    evidence: EvidenceStore,
    options: SupervisorOptions = {}
  ) {
    this.#engine = engine;
    this.#transcripts = transcripts;
    this.#onNotice = options.onNotice ?? null;
    this.workspaces = options.workspaces ?? new Workspaces({ worktreesDir: config.worktreesDir });
    const active = new Map<string, ActiveRun>();
    const providers = options.providers ?? new ProviderRegistry();
    const leasing = new AccountLeasing(options.accounts ?? null, () => this.#engine.state, transcripts);
    this.#questions = new Questions({
      engine,
      transcripts,
      active,
      execute: (runId, prompt) => this.execute(runId, prompt),
      idle: options.idle,
    });
    const tools = new ToolCalls({
      engine,
      evidence,
      transcripts,
      providers,
      questions: this.#questions,
      schedules: options.schedules ?? null,
      minuteMs: options.minuteMs ?? MINUTE_MS,
      manage: options.manage ?? null,
      workspaces: this.workspaces,
      services: options.services ?? null,
      listServerNames: (run) => this.#runtime.runPromise(listServerNames(run)),
    });
    this.#deliveries = new Deliveries({
      engine,
      transcripts,
      active,
      execute: (runId, prompt, delivery) => this.execute(runId, prompt, delivery),
    });
    const compaction = new IdleCompaction(
      () => this.#engine.state,
      (runId, sessionId, signal) => this.#runtime.runPromise(compactSession(runId, sessionId, signal)),
      options.compaction
    );
    const world = RunWorld.layer({
      engine,
      config,
      transcripts,
      providers,
      leasing,
      recordEntry: (runId, entry) => this.#recordEntry(runId, entry),
    });
    const host = RunHost.layer({
      active,
      control: this.#control,
      questions: this.#questions,
      deliveries: this.#deliveries,
      compaction,
      tools,
      extensionSets: new SessionExtensionSets(transcripts, () => this.#engine.state),
      evidence,
      limits: {
        maxRunMs: options.maxRunMs ?? MAX_RUN_MS,
        clockTimers: options.clockTimers,
        quiesceMs: options.quiesceMs ?? QUIESCE_MS,
        stopMs: options.stopMs ?? STOP_MS,
      },
      hooks: {
        startSession: options.startSession ?? null,
        onRejection: options.onRejection ?? null,
        onNotice: this.#onNotice,
        trackProcess: options.trackProcess ?? null,
        extensions: options.extensions ?? null,
        manages: options.manage !== undefined,
      },
    });
    this.#runtime = ManagedRuntime.make(Layer.mergeAll(world, host, JsonLogger));
  }

  execute(runId: string, override: string | null = null, delivery: Delivery | null = null) {
    return this.#runtime.runPromise(runToEnd(runId, override, delivery));
  }

  #recordEntry(runId: string, entry: ChatEvent) {
    this.#transcripts.record(runId, entry);
    if (entry.type === 'notice') this.#onNotice?.(runId, entry.notice);
  }

  quiesce(taskId: string, except?: string) {
    return this.#runtime.runPromise(quiesceTask(taskId, except));
  }

  steer(runId: string, text: string, cause?: string, from?: 'shinsa') {
    return this.#runtime.runPromise(steerRun(runId, text, cause, from));
  }

  cancel(runId: string) {
    return this.#runtime.runPromise(cancelRun(runId));
  }

  holdNewRuns(onHeld: () => void) {
    this.#control.holding = onHeld;
  }

  releaseHeldRuns() {
    this.#runtime.runSync(releaseHeld());
  }

  isHeld(runId: string) {
    return this.#control.held.has(runId);
  }

  interruptForShutdown() {
    return this.#runtime.runPromise(shutdownRuns());
  }

  resolveQuestion(gateId: string) {
    return this.#questions.resolve(gateId);
  }

  replyToDelegate(runId: string, questionId: string) {
    return this.#questions.replyToDelegate(runId, questionId);
  }

  deliver(runId: string, generation: number) {
    return this.#deliveries.deliver(runId, generation);
  }

  wake(runId: string, generation: number) {
    return this.#deliveries.wake(runId, generation);
  }

  recover() {
    return this.#runtime.runPromise(recoverRuns());
  }
}
