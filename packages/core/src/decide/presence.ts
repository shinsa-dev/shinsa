import type { CommandOf } from '../commands/index.ts';
import { DAY_MS, DomainError } from '../domain/index.ts';
import { isTimeZone } from '../schedules/time.ts';
import { resolvePresenceHour } from '../state/presence.ts';
import type { Decider } from './decider.ts';

const AWAY_SPAN_LIMIT_MS = 30 * DAY_MS;

export function recordAway(decider: Decider, command: CommandOf<'away.record'>) {
  if (decider.context.onBehalf) {
    throw new DomainError({
      code: 'human_only',
      message: 'Only your own Mac records the time you were away.',
    });
  }
  assertAwaySpan(decider, command);
  decider.emit({ type: 'away.recorded', from: command.from, to: command.to });
}

function assertAwaySpan(decider: Decider, { from, to }: { from: number; to: number }) {
  if (from >= to || to > decider.context.now || to - from > AWAY_SPAN_LIMIT_MS) {
    throw new DomainError({
      code: 'away_refused',
      message: 'Time away starts before it ends, ends by now and lasts at most 30 days.',
    });
  }
}

export function recordIdle(decider: Decider, command: CommandOf<'idle.record'>) {
  if (command.away) {
    assertAwaySpan(decider, command.away);
    decider.emit({ type: 'away.recorded', from: command.away.from, to: command.away.to });
  }
  const usedAt = Math.min(command.inputAt, decider.context.now);
  if (decider.state.presence[String(resolvePresenceHour(usedAt))] !== undefined) return;
  decider.emit({ type: 'mac.used', usedAt });
}

export function recordClock(decider: Decider, command: CommandOf<'clock.record'>) {
  if (!isTimeZone(command.timeZone)) {
    throw new DomainError({ code: 'clock_refused', message: `${command.timeZone} is not a time zone.` });
  }
  if (decider.state.timeZone === command.timeZone) return;
  decider.emit({ type: 'clock.recorded', timeZone: command.timeZone });
}
