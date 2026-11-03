import { Layer, ManagedRuntime } from 'effect';
import type { ServerConfig } from '../config/index.ts';
import { JsonLogger } from '../log/service.ts';
import type { Engine } from '../runtime/engine.ts';
import type { EvidenceStore } from '../store/index.ts';
import { Workspaces } from '../workspaces/index.ts';
import type { Delivery } from './delegations/schema.ts';
import type { SupervisorOptions } from './supervisor/schema.ts';
import { RunSupervisor as Supervisor } from './supervisor/service.ts';
import type { Transcripts } from './transcripts/index.ts';

export type { NoticeListener, SupervisorOptions } from './supervisor/schema.ts';

export class RunSupervisor {
  readonly #runtime: ManagedRuntime.ManagedRuntime<Supervisor, never>;
  readonly workspaces: Workspaces;

  constructor(
    engine: Engine,
    config: ServerConfig,
    transcripts: Transcripts,
    evidence: EvidenceStore,
    options: SupervisorOptions = {}
  ) {
    this.workspaces = options.workspaces ?? new Workspaces({ worktreesDir: config.worktreesDir });
    const layer = Supervisor.layer({
      engine,
      config,
      transcripts,
      evidence,
      workspaces: this.workspaces,
      options,
    });
    this.#runtime = ManagedRuntime.make(layer.pipe(Layer.provideMerge(JsonLogger)));
  }

  execute(runId: string, override: string | null = null, delivery: Delivery | null = null) {
    return this.#runtime.runPromise(
      Supervisor.use((supervisor) => supervisor.execute(runId, override, delivery))
    );
  }

  quiesce(taskId: string, except?: string) {
    return this.#runtime.runPromise(Supervisor.use((supervisor) => supervisor.quiesce(taskId, except)));
  }

  steer(runId: string, text: string, cause?: string, from?: 'shinsa') {
    return this.#runtime.runPromise(
      Supervisor.use((supervisor) => supervisor.steer(runId, text, cause, from))
    );
  }

  cancel(runId: string) {
    return this.#runtime.runPromise(Supervisor.use((supervisor) => supervisor.cancel(runId)));
  }

  holdNewRuns(onHeld: () => void) {
    this.#runtime.runSync(Supervisor.use((supervisor) => supervisor.holdNewRuns(onHeld)));
  }

  releaseHeldRuns() {
    this.#runtime.runSync(Supervisor.use((supervisor) => supervisor.releaseHeldRuns));
  }

  isHeld(runId: string) {
    return this.#runtime.runSync(Supervisor.use((supervisor) => supervisor.isHeld(runId)));
  }

  interruptForShutdown() {
    return this.#runtime.runPromise(Supervisor.use((supervisor) => supervisor.interruptForShutdown));
  }

  resolveQuestion(gateId: string) {
    return this.#runtime.runPromise(Supervisor.use((supervisor) => supervisor.resolveQuestion(gateId)));
  }

  replyToDelegate(runId: string, questionId: string) {
    return this.#runtime.runPromise(
      Supervisor.use((supervisor) => supervisor.replyToDelegate(runId, questionId))
    );
  }

  deliver(runId: string, generation: number) {
    return this.#runtime.runPromise(Supervisor.use((supervisor) => supervisor.deliver(runId, generation)));
  }

  wake(runId: string, generation: number) {
    return this.#runtime.runPromise(Supervisor.use((supervisor) => supervisor.wake(runId, generation)));
  }

  recover() {
    return this.#runtime.runPromise(Supervisor.use((supervisor) => supervisor.recover));
  }
}
