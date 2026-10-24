import type { LoadedExtensions, ShinsaState } from '@shinsa/core';
import type { Transcripts } from './transcripts/index.ts';

export class SessionExtensionSets {
  readonly #known = new Map<string, LoadedExtensions>();
  readonly #transcripts: Transcripts;
  readonly #state: () => ShinsaState;

  constructor(transcripts: Transcripts, state: () => ShinsaState) {
    this.#transcripts = transcripts;
    this.#state = state;
  }

  select(sessionId: string): LoadedExtensions | null {
    const known = this.#known.get(sessionId) ?? this.#readAnnounced(sessionId);
    if (known) this.#known.set(sessionId, known);
    return known;
  }

  record(sessionId: string, loaded: LoadedExtensions) {
    this.#known.set(sessionId, loaded);
  }

  #readAnnounced(sessionId: string): LoadedExtensions | null {
    const runs = Object.values(this.#state().runs)
      .filter((run) => run.sessionId === sessionId)
      .sort((left, right) => right.startedAt - left.startedAt);
    for (const run of runs) {
      const announced = this.#transcripts
        .listEntries(run.id)
        .flatMap((entry) =>
          entry.type === 'notice' && entry.notice.kind === 'extensions' ? [entry.notice] : []
        )
        .at(-1);
      if (announced) {
        const { servers, skills, plugins, deferred = [] } = announced;
        return { servers, skills, plugins, deferred };
      }
    }
    return null;
  }
}
