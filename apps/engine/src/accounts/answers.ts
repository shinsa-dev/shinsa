import { Option, Schema } from 'effect';
import type { CommandResult } from '../shell/schema.ts';
import {
  type AuthStatus,
  AuthStatusAnswer,
  type CswapAccount,
  CswapEntry,
  CswapListAnswer,
  type StoredLogin,
  StoredLoginAnswer,
} from './schema.ts';

const decodeLogin = Schema.decodeUnknownOption(StoredLoginAnswer);

const decodeStatus = Schema.decodeUnknownOption(AuthStatusAnswer);

const decodeList = Schema.decodeUnknownOption(CswapListAnswer);

const decodeEntry = Schema.decodeUnknownOption(CswapEntry);

export function parseStoredLogin(raw: string): StoredLogin | null {
  return Option.getOrNull(
    Option.map(decodeLogin(raw), ({ claudeAiOauth: oauth }) => ({
      accessToken: oauth.accessToken,
      refreshToken: oauth.refreshToken ?? null,
      expiresAt: oauth.expiresAt ?? null,
      plan: oauth.subscriptionType ?? null,
    }))
  );
}

function selectStatusJson(output: string) {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  return start < 0 || end < start ? Option.none() : decodeStatus(output.slice(start, end + 1));
}

export function parseAuthStatus(result: CommandResult): AuthStatus {
  const answer = selectStatusJson(result.stdout);
  if (Option.isNone(answer)) {
    const detail = (result.stderr || result.stdout).split('\n')[0]?.trim() || null;
    return { signIn: 'unknown', email: null, organization: null, plan: null, detail };
  }
  const fields = answer.value;
  if (fields.loggedIn !== true) {
    return { signIn: 'signed_out', email: null, organization: null, plan: null, detail: 'Not signed in.' };
  }
  return {
    signIn: 'signed_in',
    email: fields.email ?? fields.account ?? fields.oauthAccount?.emailAddress ?? null,
    organization: fields.orgName ?? null,
    plan: fields.subscriptionType ?? null,
    detail: null,
  };
}

export function parseCswapList(stdout: string): CswapAccount[] {
  const accounts = Option.getOrUndefined(decodeList(stdout))?.accounts ?? [];
  return accounts.flatMap((value) =>
    Option.toArray(decodeEntry(value)).flatMap((entry) =>
      entry.kind === 'api_key' ? [] : [{ email: entry.email }]
    )
  );
}
