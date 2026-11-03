import type { CommandOf } from '../commands/index.ts';
import { DAY_MS, DomainError } from '../domain/index.ts';
import type { Decider } from './decider.ts';

const AWAY_SPAN_LIMIT_MS = 30 * DAY_MS;

export function recordAway(decider: Decider, command: CommandOf<'away.record'>) {
  if (decider.context.onBehalf) {
    throw new DomainError({
      code: 'human_only',
      message: 'Only your own Mac records the time you were away.',
    });
  }
  const { from, to } = command;
  if (from >= to || to > decider.context.now || to - from > AWAY_SPAN_LIMIT_MS) {
    throw new DomainError({
      code: 'away_refused',
      message: 'Time away starts before it ends, ends by now and lasts at most 30 days.',
    });
  }
  decider.emit({ type: 'away.recorded', from, to });
}
