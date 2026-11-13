import { Option } from 'effect';
import { MODEL_ROUTES } from '../agent-models/routing.ts';
import type { AccountModelRoom, ModelRoom, ModelRoomReading } from '../domain/accounts.ts';
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
  const readings = accounts.map((account): AccountModelRoom => {
    const candidate = resolveAccountCandidate(account, settings);
    return {
      account: account.id,
      usable: isUsableAccount(candidate, family, now),
      left: Option.getOrNull(resolveHeadroom(candidate.usage, family)),
    };
  });
  const usable = readings.filter((reading) => reading.usable);
  const known = usable.flatMap((reading) => (reading.left === null ? [] : [reading.left]));
  return {
    family,
    usable: usable.length > 0,
    left: known.length > 0 ? Math.max(...known) : null,
    accounts: readings,
  };
}

export function listModelRoom(accounts: readonly AccountSummary[], settings: Settings, now: number) {
  const signedIn = accounts.filter((account) => account.signIn === 'signed_in');
  if (signedIn.length === 0) return [];
  return ROUTED_FAMILIES.map((family) => resolveFamilyRoom(signedIn, settings, family, now));
}

function isReadingMoved(
  before: AccountModelRoom | ModelRoom | undefined,
  after: AccountModelRoom | ModelRoomReading
) {
  if (!before || before.usable !== after.usable) return true;
  if (before.left === null || after.left === null) return before.left !== after.left;
  return Math.abs(before.left - after.left) >= MODEL_ROOM_STEP;
}

export function isModelRoomMoved(
  known: Readonly<Record<string, ModelRoom>>,
  models: readonly ModelRoomReading[]
) {
  if (Object.keys(known).length !== models.length) return true;
  return models.some((model) => {
    const before = known[model.family];
    if (!before || isReadingMoved(before, model) || before.accounts.length !== model.accounts.length)
      return true;
    return model.accounts.some((reading) =>
      isReadingMoved(
        before.accounts.find((kept) => kept.account === reading.account),
        reading
      )
    );
  });
}
