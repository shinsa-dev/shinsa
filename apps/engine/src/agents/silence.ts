import { isRunWaiting, listLiveRuns, type Run, SILENCE_MINUTES } from '@shinsa/core';
import { describeError, log } from '../log/index.ts';
import type { Engine } from '../runtime/engine.ts';
import { MINUTE_MS } from './clock.ts';
import type { Transcripts } from './transcripts/index.ts';

interface SilenceWatchOptions {
  now?: () => number;
  intervalMs?: number;
}

const INTERVAL_MS = 30_000;

export class SilenceWatch {
  readonly #engine: Engine;
  readonly #transcripts: Transcripts;
  readonly #now: () => number;
  readonly #intervalMs: number;
  readonly #lastOutput = new Map<string, number>();
  #timer: ReturnType<typeof setInterval> | null = null;
  #unsubscribe: (() => void) | null = null;

  constructor(engine: Engine, transcripts: Transcripts, options: SilenceWatchOptions = {}) {
    this.#engine = engine;
    this.#transcripts = transcripts;
    this.#now = options.now ?? Date.now;
    this.#intervalMs = options.intervalMs ?? INTERVAL_MS;
  }

  start() {
    this.#unsubscribe ??= this.#transcripts.subscribe((runId) => this.#heard(runId));
    this.#timer ??= setInterval(() => {
      this.check().catch((error: unknown) => {
        log.warn('[Silence] Could not check for quiet runs', { error: describeError(error) });
      });
    }, this.#intervalMs);
    this.#timer.unref();
  }

  stop() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  #heard(runId: string) {
    this.#lastOutput.set(runId, this.#now());
    const run = this.#engine.state.runs[runId];
    if (!run?.silence || run.silence.since === null) return;
    this.#recordHeard(run, run.silence.since);
  }

  #recordHeard(run: Run, since: number) {
    this.#engine
      .dispatch(
        { type: 'run.silence', runId: run.id, since: null },
        { id: `run.silence:${run.id}:${since}:heard` }
      )
      .catch((error: unknown) => {
        log.warn('[Silence] Could not record a quiet run', { runId: run.id, error: describeError(error) });
      });
  }

  #seed(run: Run) {
    const last = this.#transcripts.listEntries(run.id).at(-1)?.at ?? run.startedAt;
    this.#lastOutput.set(run.id, last);
    return last;
  }

  async check() {
    const now = this.#now();
    const live = new Set<string>();
    for (const run of listLiveRuns(this.#engine.state)) {
      live.add(run.id);
      if (
        run.status === 'queued' ||
        isRunWaiting(this.#engine.state, run) ||
        (run.silence && run.silence.since !== null)
      )
        continue;
      const last = this.#lastOutput.get(run.id) ?? this.#seed(run);
      if (now - last < SILENCE_MINUTES.suspicious * MINUTE_MS) continue;
      await this.#engine.dispatch(
        { type: 'run.silence', runId: run.id, since: last },
        { id: `run.silence:${run.id}:${last}` }
      );
    }
    for (const runId of this.#lastOutput.keys()) {
      if (!live.has(runId)) this.#lastOutput.delete(runId);
    }
  }
}
