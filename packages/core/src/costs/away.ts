import { Option } from 'effect';
import { resolveAgentProvider } from '../agent-models/index.ts';
import {
  DAY_MS,
  HOUR_MS,
  resolveAutoPace,
  type RunPurpose,
  type RunRole,
  type Task,
  type TimingSpan,
} from '../domain/index.ts';
import type { ShinsaState } from '../state/project.ts';
import { resolveAdmissionRoom } from './admission.ts';

export const AWAY_LIMITS = {
  windowDays: 14,
  minDays: 3,
  coveredShare: 0.5,
  awayShare: 0.5,
  activeShare: 0.15,
} as const;

export type AwaySource = 'away' | 'activity';

export interface AwayHours {
  hours: readonly number[];
  source: AwaySource;
}

export type NightShift = 'unattended' | 'night';

type AwayState = Pick<ShinsaState, 'away' | 'presence'>;

const DAY_HOURS = 24;

function resolveHourOfDay(hour: number) {
  return ((hour % DAY_HOURS) + DAY_HOURS) % DAY_HOURS;
}

function listCoveredHours(spans: readonly TimingSpan[], from: number, to: number) {
  const covered = new Set<number>();
  for (const span of spans) {
    const start = Math.max(span.from, from);
    const end = Math.min(span.to, to);
    for (let hour = Math.floor(start / HOUR_MS); hour * HOUR_MS < end; hour += 1) {
      const overlap = Math.min(end, (hour + 1) * HOUR_MS) - Math.max(start, hour * HOUR_MS);
      if (overlap >= HOUR_MS * AWAY_LIMITS.coveredShare) covered.add(hour);
    }
  }
  return covered;
}

function resolveDayShares(hours: ReadonlySet<number>, now: number) {
  const days = new Set([...hours].map((hour) => Math.floor(hour / DAY_HOURS)));
  if (days.size < AWAY_LIMITS.minDays) return null;
  const observed = Math.floor(now / DAY_MS) - Math.min(...days) + 1;
  const counts = Array.from({ length: DAY_HOURS }, () => 0);
  for (const hour of hours) counts[resolveHourOfDay(hour)] = (counts[resolveHourOfDay(hour)] ?? 0) + 1;
  return counts.map((count) => count / observed);
}

function resolveFromAway(state: AwayState, from: number, now: number) {
  const shares = resolveDayShares(listCoveredHours(Object.values(state.away), from, now), now);
  if (!shares) return null;
  return shares.flatMap((share, hour) => (share >= AWAY_LIMITS.awayShare ? [hour] : []));
}

function resolveFromActivity(state: AwayState, from: number, now: number) {
  const active = new Set(
    Object.entries(state.presence)
      .filter(([hour, count]) => count > 0 && Number(hour) * HOUR_MS >= from && Number(hour) * HOUR_MS < now)
      .map(([hour]) => Number(hour))
  );
  const shares = resolveDayShares(active, now);
  if (!shares) return null;
  return shares.flatMap((share, hour) => (share < AWAY_LIMITS.activeShare ? [hour] : []));
}

export function resolveAwayHours(state: AwayState, now: number): Option.Option<AwayHours> {
  const from = now - AWAY_LIMITS.windowDays * DAY_MS;
  const away = resolveFromAway(state, from, now);
  if (away) return Option.some({ hours: away, source: 'away' });
  const activity = resolveFromActivity(state, from, now);
  return activity ? Option.some({ hours: activity, source: 'activity' }) : Option.none();
}

export function isAwayAt(away: Option.Option<AwayHours>, at: number) {
  return Option.exists(away, (known) => known.hours.includes(resolveHourOfDay(Math.floor(at / HOUR_MS))));
}

function hasAdmissionQueue(state: ShinsaState, task: Task) {
  return Object.values(state.tasks).some((other) => {
    const wait = other.usageWait;
    return other.id !== task.id && wait?.pace?.scope === 'admission' && wait.status === 'armed';
  });
}

export function resolveNightShift(
  state: ShinsaState,
  task: Task,
  role: RunRole,
  purpose: RunPurpose | null,
  now: number
): Option.Option<NightShift> {
  if (role !== 'agent' || !resolveAutoPace(state.settings)) return Option.none();
  const away = isAwayAt(resolveAwayHours(state, now), now);
  if (purpose === 'build' || purpose === 'fix') return away ? Option.some('night') : Option.none();
  if (purpose !== 'plan') return Option.none();
  if (away || hasAdmissionQueue(state, task)) return Option.some('unattended');
  const room = resolveAdmissionRoom(state, resolveAgentProvider(state.settings, 'agent'), now);
  return Option.exists(room, (left) => left <= 0) ? Option.some('unattended') : Option.none();
}
