import { type ChatNotice, type CompactionMode, isEunoeCompaction } from '@shinsa/core';

export const DIRECT_BASE_URL = 'https://api.anthropic.com';

export const BLOCKING_LIMIT_ENV = 'CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE';

const BLOCKING_LIMIT_OFF = '1000000000';

export type EunoeStatus = { ok: true; url: string; dir: string } | { ok: false; reason: string };

export interface EunoeWatcher {
  notice: (notice: ChatNotice) => void;
  stuck: () => void;
}

export interface EunoeLink {
  ensure: () => Promise<EunoeStatus>;
  watch: (sessionId: string, watcher: EunoeWatcher) => () => void;
  fold: (sessionId: string, warm: boolean) => () => void;
}

interface ClaudeRoute {
  env: Record<string, string>;
  autoCompact: boolean;
  eunoe: boolean;
  notice: ChatNotice | null;
}

function resolveDirectRoute(autoCompact: boolean, notice: ChatNotice | null = null): ClaudeRoute {
  return {
    env: { ANTHROPIC_BASE_URL: DIRECT_BASE_URL, [BLOCKING_LIMIT_ENV]: '' },
    autoCompact,
    eunoe: false,
    notice,
  };
}

export async function resolveClaudeRoute(
  compaction: CompactionMode,
  eunoe: EunoeLink | null
): Promise<ClaudeRoute> {
  if (!isEunoeCompaction(compaction)) return resolveDirectRoute(compaction === 'provider');
  let status: EunoeStatus = { ok: false, reason: 'Eunoe is not set up in this Shinsa.' };
  if (eunoe) status = await eunoe.ensure();
  if (!status.ok) {
    return resolveDirectRoute(true, {
      kind: 'proxy',
      proxy: 'eunoe',
      status: 'unavailable',
      detail: status.reason,
    });
  }
  return {
    env: { ANTHROPIC_BASE_URL: status.url, [BLOCKING_LIMIT_ENV]: BLOCKING_LIMIT_OFF, EUNOE_DIR: status.dir },
    autoCompact: false,
    eunoe: true,
    notice: null,
  };
}
