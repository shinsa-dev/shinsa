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

export interface AccountUsage {
  status: UsageReadStatus;
  windows: UsageWindow[];
  detail: string | null;
  checkedAt: number | null;
  source: UsageSource | null;
  fastMode?: FastModeAvailability;
}

export interface AccountSummary {
  id: string;
  email: string | null;
  organization: string | null;
  plan: string | null;
  origin: AccountOrigin;
  isDefault: boolean;
  paused: boolean;
  switchAt: number | null;
  signIn: AccountSignIn;
  signInDetail: string | null;
  usage: AccountUsage;
  spentUntil: number | null;
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
  origin: Exclude<AccountOrigin, 'login'>;
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

export interface AccountsSnapshot {
  accounts: AccountSummary[];
  login: AccountLogin | null;
  imports: AccountImport[];
  providers?: ProviderLogin[];
}

export type AccountPatch = Partial<{
  isDefault: true;
  paused: boolean;
  switchAt: number | null;
  position: number;
}>;
