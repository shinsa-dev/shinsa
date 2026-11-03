import { Effect } from 'effect';
import type { ConfigStore } from '../config/index.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import type { RootsHandle } from './roots/schema.ts';
import { makeRoots } from './roots/service.ts';
import type { Discoverer, Discovery, RootSource, RootSourceKind } from './schema.ts';

export class Roots implements RootSource {
  readonly #fromEnvironment: string[];
  readonly #store: ConfigStore;
  readonly #handle: RootsHandle;

  constructor(fromEnvironment: string[], store: ConfigStore, userHome: string, discover?: Discoverer) {
    this.#fromEnvironment = fromEnvironment;
    this.#store = store;
    this.#handle = edgeRuntime.runSync(
      makeRoots({
        fromEnvironment,
        configured: Effect.sync(() => store.config.roots),
        home: userHome,
        discover: discover ? (home) => Effect.promise(() => discover(home)) : null,
      })
    );
  }

  get fromEnvironment() {
    return [...this.#fromEnvironment];
  }

  get configured() {
    return [...this.#store.config.roots];
  }

  resolveKind(): RootSourceKind {
    if (this.#store.config.roots.length > 0) return 'configured';
    if (this.#fromEnvironment.length > 0) return 'environment';
    return 'discovered';
  }

  discover(force = false): Promise<Discovery> {
    return edgeRuntime.runPromise(this.#handle.discover(force));
  }

  listRoots() {
    return edgeRuntime.runPromise(this.#handle.listRoots);
  }
}
