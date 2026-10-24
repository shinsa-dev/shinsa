import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveCodexExecutable } from '../../src/agents/providers/codex/executable.ts';
import type { CodexRuntime } from '../../src/agents/providers/codex/session.ts';
import { createTempDir } from './index.ts';

export type FakeCodexStep = Record<string, unknown>;

interface FakeCodexState {
  threads: string[];
  scripts: Record<string, FakeCodexStep[][]>;
  quick?: string;
  quickFails?: boolean;
  models?: Record<string, unknown>[];
  modelPages?: boolean;
  rateLimits?: Record<string, unknown>;
  missing?: boolean;
  refuse?: string[];
  ignore?: string[];
  noise?: boolean;
  standardOnly?: boolean;
  rateLimitsByLimitId?: Record<string, unknown>;
  account?: Record<string, unknown> | null;
  compact?: 'fails' | 'noTurn';
}

interface FakeCodexEntry {
  pid: number;
  method?: string;
  params?: Record<string, unknown>;
  approval?: string;
  patch?: string;
  decision?: string;
  tool?: string;
  isError?: boolean;
  turn?: string;
  role?: string | null;
  script?: string;
  progress?: string;
  elicited?: string;
  action?: string;
  asked?: string;
  answer?: Record<string, unknown>;
}

export class FakeCodex {
  readonly path: string;
  readonly env: Record<string, string>;
  readonly runtime: CodexRuntime;

  constructor(state: Partial<FakeCodexState> = {}, env: Record<string, string> = {}) {
    this.path = join(createTempDir('shinsa-codex-'), 'codex.json');
    this.write({ threads: [], scripts: {}, ...state });
    this.env = { FAKE_CODEX_STATE: this.path, ...env };
    this.runtime = { resolveExecutable: () => resolveCodexExecutable(), env: this.env };
  }

  read(): FakeCodexState {
    return JSON.parse(readFileSync(this.path, 'utf8')) as FakeCodexState;
  }

  write(state: FakeCodexState) {
    writeFileSync(this.path, JSON.stringify(state));
  }

  update(change: (state: FakeCodexState) => void) {
    const state = this.read();
    change(state);
    this.write(state);
  }

  script(role: string, ...turns: FakeCodexStep[][]) {
    this.update((state) => {
      state.scripts[role] = [...(state.scripts[role] ?? []), ...turns];
    });
  }

  get log(): FakeCodexEntry[] {
    const path = `${this.path}.log`;
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as FakeCodexEntry);
  }

  requests(method: string) {
    return this.log.filter((entry) => entry.method === method).map((entry) => entry.params ?? {});
  }
}
