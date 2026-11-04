import type { AccountOrigin } from '@shinsa/core';

export const SHARED_LOGIN_DETAIL: Record<Exclude<AccountOrigin, 'login'>, string> = {
  cswap:
    'Shinsa holds a copy of claude-swap’s login for this account, so each one signs the other out. Sign in again to give Shinsa a login of its own.',
  claude:
    'Shinsa runs this account on your Claude Code login, which Claude Code and claude-swap change and refresh too. Sign in again to give Shinsa a login of its own.',
};
