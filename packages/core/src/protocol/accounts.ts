export type AccountOrigin = 'claude' | 'login' | 'cswap';

export type AccountSignIn = 'signed_in' | 'signed_out' | 'unknown';

export type UsageWindowKind = 'session' | 'weekly' | 'model' | 'other';

export type UsageReadStatus = 'ok' | 'unavailable' | 'unknown';

export type UsageSource = 'read' | 'push' | 'cache';

export type FastModeAvailability = 'available' | 'needs_credits' | 'unknown';

export interface UsageWindow {
  id: string;
  kind: UsageWindowKind;
  label: string;
  model: string | null;
  usedPercent: number;
  resetsAt: number | null;
}

export interface UsageMoney {
  minor: number;
  exponent: number;
  currency: string;
}

export interface ExtraUsage {
  enabled: boolean;
  noLimit: boolean;
  credit: UsageMoney | null;
}

export interface UsageResetGrant {
  id: string;
  label: string | null;
  left: number;
  total: number;
  clears: string[];
  usableNow: boolean;
  endsAt: number | null;
  givesBackWeekly: boolean;
  weeklyShare: number | null;
}

export interface AccountUsage {
  status: UsageReadStatus;
  windows: UsageWindow[];
  detail: string | null;
  checkedAt: number | null;
  source: UsageSource | null;
  fastMode?: FastModeAvailability;
  extraUsage?: ExtraUsage;
  resetGrants?: UsageResetGrant[];
  retryAt?: number;
}

export interface AccountSummary {
  id: string;
  email: string | null;
  organization: string | null;
  plan: string | null;
  origin: AccountOrigin;
  owner?: string | null;
  isDefault: boolean;
  paused: boolean;
  switchAt: number | null;
  signIn: AccountSignIn;
  signInDetail: string | null;
  usage: AccountUsage;
  spentUntil: number | null;
  spentModel?: string | null;
  runs: number;
}

export type AccountLoginPhase = 'starting' | 'waiting' | 'finishing' | 'done' | 'failed';

export interface AccountLogin {
  id: string;
  accountId: string;
  email: string | null;
  phase: AccountLoginPhase;
  url: string | null;
  message: string | null;
  startedAt: number;
}

export interface AccountImport {
  origin: 'cswap';
  email: string;
  plan: string | null;
}

export type ProviderLoginStatus = 'signed_in' | 'signed_out' | 'not_installed' | 'outdated' | 'unknown';

export interface ProviderLogin {
  provider: string;
  label: string;
  status: ProviderLoginStatus;
  method: string | null;
  version: string | null;
  detail: string | null;
  fix: string | null;
  email?: string | null;
  plan?: string | null;
  usage?: AccountUsage;
}

export interface AccountDuplicate {
  id: string;
  email: string;
  keptId: string;
}

export interface AccountsSnapshot {
  accounts: AccountSummary[];
  login: AccountLogin | null;
  imports: AccountImport[];
  duplicates?: AccountDuplicate[];
  providers?: ProviderLogin[];
}

export type AccountPatch = Partial<{
  isDefault: true;
  paused: boolean;
  switchAt: number | null;
  position: number;
}>;
