import { homedir } from 'node:os';
import { log } from '../log/index.ts';
import type { CommandOptions, CommandResult } from '../shell/index.ts';
import { parseCswapList } from './answers.ts';
import { CSWAP_BINARIES, CSWAP_LIST_TTL_MS, CSWAP_TIMEOUT_MS, type CswapAccount } from './schema.ts';

export { parseCswapList } from './answers.ts';
export type { CswapAccount } from './schema.ts';

export type CswapRunner = (command: string[], cwd: string, options: CommandOptions) => Promise<CommandResult>;

export interface CswapOptions {
  run: CswapRunner;
  which?: (command: string) => string | null;
  now?: () => number;
}

export class Cswap {
  readonly #options: CswapOptions;
  #listed: { at: number; accounts: CswapAccount[] } | null = null;

  constructor(options: CswapOptions) {
    this.#options = options;
  }

  #binary() {
    const which = this.#options.which ?? ((command: string) => Bun.which(command));
    for (const name of CSWAP_BINARIES) {
      const path = which(name);
      if (path) return path;
    }
    return null;
  }

  async list(): Promise<CswapAccount[]> {
    const now = (this.#options.now ?? Date.now)();
    if (this.#listed && now - this.#listed.at < CSWAP_LIST_TTL_MS) return this.#listed.accounts;
    const binary = this.#binary();
    if (!binary) return [];
    const result = await this.#options.run([binary, 'list', '--json'], homedir(), {
      timeoutMs: CSWAP_TIMEOUT_MS,
    });
    const accounts = result.ok ? parseCswapList(result.stdout) : [];
    if (!result.ok) log.warn('[Accounts] claude-swap did not list its accounts', { code: result.code });
    this.#listed = { at: now, accounts };
    return accounts;
  }
}
