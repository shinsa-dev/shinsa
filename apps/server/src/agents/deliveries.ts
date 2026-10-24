import { describeError, log } from '../log/index.ts';
import type { Engine } from '../runtime/engine.ts';
import { type ActiveRun, isSteerable, resolveAttemptKey } from './active.ts';
import { type Delivery, resolveDelivery } from './delegations.ts';
import type { Transcripts } from './transcripts/index.ts';

interface DeliveriesOptions {
  engine: Engine;
  transcripts: Transcripts;
  active: ReadonlyMap<string, ActiveRun>;
  execute: (runId: string, prompt: string, delivery: Delivery) => Promise<void>;
}

export class Deliveries {
  readonly #options: DeliveriesOptions;

  constructor(options: DeliveriesOptions) {
    this.#options = options;
  }

  async deliver(runId: string, generation: number) {
    const state = this.#options.engine.state;
    const run = state.runs[runId];
    const delivery = run && run.endedAt === null ? resolveDelivery(state, run) : null;
    if (!delivery || delivery.generation !== generation) return;
    const active = this.#options.active.get(runId);
    if (!active || !isSteerable(active)) {
      await this.#recordUndelivered(runId, generation);
      return;
    }
    if (!active.session) {
      active.held.push(delivery);
      return;
    }
    await this.steer(runId, active, delivery);
  }

  async wake(runId: string, generation: number) {
    const state = this.#options.engine.state;
    const run = state.runs[runId];
    if (!run || run.endedAt !== null || run.status !== 'waiting' || this.#options.active.has(runId)) return;
    const delivery = resolveDelivery(state, run);
    if (delivery?.generation !== generation) return;
    await this.#options.execute(runId, delivery.text, delivery);
  }

  async steer(runId: string, active: ActiveRun, delivery: Delivery) {
    if (!active.session?.steer(delivery.text, 'shinsa')) {
      await this.#recordUndelivered(runId, delivery.generation);
      return;
    }
    active.steered.set(delivery.text, delivery.items);
    this.#recordReported(runId, delivery);
    await this.#recordDelivered(runId, delivery);
  }

  confirmWake(runId: string, active: ActiveRun) {
    const delivery = active.delivery;
    if (!delivery) return;
    active.delivery = null;
    this.#recordReported(runId, delivery);
    this.#recordDelivered(runId, delivery).catch((error: unknown) => {
      log.warn('[Runs] Could not record a delivered report', { runId, error: describeError(error) });
    });
  }

  async release(runId: string, active: ActiveRun, undelivered: string[]) {
    const items = undelivered.flatMap((text) => active.steered.get(text) ?? []);
    if (items.length > 0) {
      const id = `delegation.release:${resolveAttemptKey(runId, active.attemptId)}:steered`;
      await this.#options.engine.dispatch(
        { type: 'delegation.release', runId, generation: null, items },
        { id }
      );
    }
    if (active.delivery) await this.#recordUndelivered(runId, active.delivery.generation);
    for (const delivery of active.held.splice(0)) await this.#recordUndelivered(runId, delivery.generation);
    return undelivered.filter((text) => !active.steered.has(text));
  }

  #recordUndelivered(runId: string, generation: number) {
    return this.#options.engine.dispatch(
      { type: 'delegation.release', runId, generation, items: [] },
      { id: `delegation.release:${runId}:${generation}` }
    );
  }

  #recordDelivered(runId: string, delivery: Delivery) {
    return this.#options.engine.dispatch(
      { type: 'delegation.record_delivery', runId, generation: delivery.generation, items: delivery.items },
      { id: `delegation.record_delivery:${runId}:${delivery.generation}` }
    );
  }

  #recordReported(runId: string, delivery: Delivery) {
    if (delivery.runIds.length === 0) return;
    this.#options.transcripts.record(runId, {
      type: 'notice',
      notice: { kind: 'delegation', event: 'reported', runIds: delivery.runIds },
    });
  }
}
