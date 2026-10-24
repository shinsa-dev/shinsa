import type { RunRole } from './types.ts';

export interface RunAccount {
  id: string;
  email: string | null;
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
