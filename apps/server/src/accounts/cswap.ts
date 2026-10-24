import { homedir } from 'node:os';
import { log } from '../log/index.ts';
import type { CommandOptions, CommandResult } from '../shell/index.ts';

export interface CswapAccount {
  email: string;
}

export interface CswapLogin {
  credentials: { claudeAiOauth: Record<string, unknown> };
  oauthAccount: Record<string, unknown> | null;
}

export type CswapRunner = (command: string[], cwd: string, options: CommandOptions) => Promise<CommandResult>;

export interface CswapOptions {
  run: CswapRunner;
  which?: (command: string) => string | null;
  now?: () => number;
}

const BINARIES = ['cswap', 'claude-swap'];

const CSWAP_TIMEOUT_MS = 30_000;

const LIST_TTL_MS = 10 * 60_000;

type Fields = Record<string, unknown>;

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseCswapList(stdout: string): CswapAccount[] {
  try {
    const parsed = JSON.parse(stdout) as { accounts?: unknown };
    const accounts = Array.isArray(parsed.accounts) ? parsed.accounts : [];
    return accounts.flatMap((account): CswapAccount[] => {
      if (!isFields(account) || typeof account.email !== 'string' || account.kind === 'api_key') return [];
      return [{ email: account.email }];
    });
  } catch {
    return [];
  }
}

export function parseCswapExport(stdout: string, email: string): CswapLogin | null {
  try {
    const parsed = JSON.parse(stdout) as { accounts?: unknown };
    const accounts = Array.isArray(parsed.accounts) ? parsed.accounts : [];
    const wanted = email.toLowerCase();
    const account = accounts.find(
      (candidate) => isFields(candidate) && String(candidate.email).toLowerCase() === wanted
    ) as Fields | undefined;
    const credentials = isFields(account?.credentials) ? account.credentials : null;
    const oauth = isFields(credentials?.claudeAiOauth) ? credentials.claudeAiOauth : null;
    if (!oauth || typeof oauth.refreshToken !== 'string') return null;
    const config = isFields(account?.config) ? account.config : null;
    return {
      credentials: { claudeAiOauth: oauth },
      oauthAccount: isFields(config?.oauthAccount) ? config.oauthAccount : null,
    };
  } catch {
    return null;
  }
}

export class Cswap {
  readonly #options: CswapOptions;
  #listed: { at: number; accounts: CswapAccount[] } | null = null;

  constructor(options: CswapOptions) {
    this.#options = options;
  }

  #binary() {
    const which = this.#options.which ?? ((command: string) => Bun.which(command));
    for (const name of BINARIES) {
      const path = which(name);
      if (path) return path;
    }
    return null;
  }

  async list(): Promise<CswapAccount[]> {
    const now = (this.#options.now ?? Date.now)();
    if (this.#listed && now - this.#listed.at < LIST_TTL_MS) return this.#listed.accounts;
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

  async export(email: string): Promise<CswapLogin | null> {
    const binary = this.#binary();
    if (!binary) return null;
    const result = await this.#options.run([binary, 'export', '-', '--account', email], homedir(), {
      timeoutMs: CSWAP_TIMEOUT_MS,
    });
    if (!result.ok) log.warn('[Accounts] claude-swap could not export a login', { code: result.code });
    return result.ok ? parseCswapExport(result.stdout, email) : null;
  }
}
