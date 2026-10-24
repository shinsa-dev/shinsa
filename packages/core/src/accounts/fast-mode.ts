import { CLAUDE_PROVIDER } from '../agent-models/index.ts';
import type { AccountSummary, AccountsSnapshot, FastModeAvailability } from '../protocol/accounts.ts';

function resolveAccountFastMode(account: AccountSummary): FastModeAvailability[] {
  if (account.paused || account.signIn === 'signed_out') return [];
  return [account.usage.fastMode ?? 'unknown'];
}

export function resolveFastModeAvailability(
  snapshot: AccountsSnapshot | null,
  provider: string
): FastModeAvailability {
  if (!snapshot) return 'unknown';
  const login = snapshot.providers?.find((entry) => entry.provider === provider);
  if (login) return login.usage?.fastMode ?? 'unknown';
  if (provider !== CLAUDE_PROVIDER) return 'unknown';
  const states = snapshot.accounts.flatMap(resolveAccountFastMode);
  if (states.includes('available')) return 'available';
  if (states.length === 0 || states.includes('unknown')) return 'unknown';
  return 'needs_credits';
}
