import { FIELD_MESSAGES, ID_LIMIT, Id, NullByDefault, Strict, Text } from './fields.ts';
import type { RunRole } from './types.ts';

export const RunAccount = Strict(
  { id: Id(), email: NullByDefault(Text(ID_LIMIT), FIELD_MESSAGES.text) },
  'An account',
  '{key}'
);

export type RunAccount = typeof RunAccount.Type;

export interface WeeklyReading {
  percent: number;
  at: number;
  resetsAt: number | null;
}

export type AccountSwitchReason = 'usage_limit' | 'signed_out' | 'headroom' | 'bound';

export type UsageWaitStatus = 'armed' | 'resumed';

export interface UsageWait {
  id: string;
  runId: string;
  role: RunRole;
  phaseIndex: number | null;
  account: RunAccount | null;
  resetAt: number;
  armedAt: number;
  autoResume: boolean;
  status: UsageWaitStatus;
  provider?: string;
}
