import type { RunAccount } from './schema.ts';
import type { RunRole } from './types.ts';

export interface WeeklyReading {
  percent: number;
  at: number;
  resetsAt: number | null;
}

export type AccountSwitchReason = 'usage_limit' | 'signed_out' | 'headroom' | 'bound';

export type UsageWaitStatus = 'armed' | 'resumed';

export type UsageWaitCause = 'usage_limit' | 'pace';

export type UsagePaceScope = 'daily' | 'project' | 'admission';

export interface UsagePace {
  scope: UsagePaceScope;
  limit: number;
  percent: number;
  projectId: string | null;
  stageReason: string;
  need?: number;
}

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
  cause?: UsageWaitCause;
  pace?: UsagePace;
}
