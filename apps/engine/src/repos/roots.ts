import type { ConfigStore } from '../config/index.ts';
import { type Discovery, discoverRoots } from './discover.ts';

type RootSourceKind = 'configured' | 'environment' | 'discovered';

export interface RootSource {
  listRoots: () => Promise<string[]>;
}

export type Discoverer = (home: string) => Promise<Discovery>;

const DISCOVERY_TTL_MS = 10 * 60 * 1000;

export class Roots implements RootSource {
  readonly #fromEnvironment: string[];
  readonly #store: ConfigStore;
  readonly #userHome: string;
  readonly #discover: Discoverer;
  #discovery: { at: number; result: Promise<Discovery> } | null = null;

  constructor(
    fromEnvironment: string[],
    store: ConfigStore,
    userHome: string,
    discover: Discoverer = discoverRoots
  ) {
    this.#fromEnvironment = fromEnvironment;
    this.#store = store;
    this.#userHome = userHome;
    this.#discover = discover;
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
    const now = Date.now();
    if (force || !this.#discovery || now - this.#discovery.at > DISCOVERY_TTL_MS) {
      this.#discovery = { at: now, result: this.#discover(this.#userHome) };
    }
    return this.#discovery.result;
  }

  async listRoots() {
    const explicit = [...new Set([...this.#fromEnvironment, ...this.#store.config.roots])];
    if (explicit.length > 0) return explicit;
    const { candidates } = await this.discover();
    return candidates.map((candidate) => candidate.path);
  }
}
