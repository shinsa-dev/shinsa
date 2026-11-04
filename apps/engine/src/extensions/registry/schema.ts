import type { ExtensionsSnapshot, McpServerStatus } from '@shinsa/core';
import type { ExtensionsSettings } from '../schema.ts';
import type { UsageView } from '../usage-index/schema.ts';

export interface UsageReading {
  readonly view: UsageView;
  readonly now: number;
  readonly file: ExtensionsSettings;
}

export interface SignInStart {
  readonly authorizationUrl: string | null;
  readonly snapshot: ExtensionsSnapshot;
}

export const UNCHECKED_STATUS: McpServerStatus = {
  state: 'unchecked',
  error: null,
  checkedAt: null,
  tools: [],
  tokens: null,
};

export const SEEN_BEFORE_WATCHING = 0;
