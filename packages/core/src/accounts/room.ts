import { Option } from 'effect';
import { MODEL_ROUTES } from '../agent-models/routing.ts';
import type { ModelRoom, ModelRoomReading } from '../domain/accounts.ts';
import type { Settings } from '../domain/settings.ts';
import type { AccountSummary } from '../protocol/accounts.ts';
import { isUsableAccount, resolveAccountCandidate } from './pick.ts';
import { resolveHeadroom } from './usage.ts';

const MODEL_ROOM_STEP = 5;

export const ROUTED_FAMILIES: readonly string[] = [...new Set(Object.values(MODEL_ROUTES).flat())];

function resolveFamilyRoom(
  accounts: readonly AccountSummary[],
  settings: Settings,
  family: string,
  now: number
): ModelRoomReading {
  const usable = accounts
    .map((account) => resolveAccountCandidate(account, settings))
    .filter((candidate) => isUsableAccount(candidate, family, now));
  const known = usable.flatMap((candidate) => Option.toArray(resolveHeadroom(candidate.usage, family)));
  return { family, usable: usable.length > 0, left: known.length > 0 ? Math.max(...known) : null };
}

export function listModelRoom(accounts: readonly AccountSummary[], settings: Settings, now: number) {
  const signedIn = accounts.filter((account) => account.signIn === 'signed_in');
  if (signedIn.length === 0) return [];
  return ROUTED_FAMILIES.map((family) => resolveFamilyRoom(signedIn, settings, family, now));
}

export function isModelRoomMoved(
  known: Readonly<Record<string, ModelRoom>>,
  models: readonly ModelRoomReading[]
) {
  if (Object.keys(known).length !== models.length) return true;
  return models.some((model) => {
    const before = known[model.family];
    if (!before || before.usable !== model.usable) return true;
    if (before.left === null || model.left === null) return before.left !== model.left;
    return Math.abs(before.left - model.left) >= MODEL_ROOM_STEP;
  });
}
