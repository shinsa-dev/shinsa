import type { ChatNotice } from '@shinsa/core';
import type { Effect } from 'effect';

export const DIRECT_BASE_URL = 'https://api.anthropic.com';

export const BLOCKING_LIMIT_ENV = 'CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE';

export const BLOCKING_LIMIT_OFF = '1000000000';

export const EUNOE_MISSING = 'Eunoe is not set up in this Shinsa.';

export type EunoeStatus = { ok: true; url: string; dir: string } | { ok: false; reason: string };

export interface EunoeWatcher {
  notice: (notice: ChatNotice) => void;
  stuck: () => void;
}

export interface EunoeLink {
  readonly ensure: Effect.Effect<EunoeStatus>;
  readonly watch: (sessionId: string, watcher: EunoeWatcher) => Effect.Effect<Effect.Effect<void>>;
  readonly fold: (sessionId: string, warm: boolean) => Effect.Effect<Effect.Effect<void>>;
}

export interface ClaudeRoute {
  env: Record<string, string>;
  autoCompact: boolean;
  eunoe: boolean;
  notice: ChatNotice | null;
}
