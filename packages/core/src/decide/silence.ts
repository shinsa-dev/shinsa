import type { CommandOf } from '../commands/index.ts';
import { DomainError } from '../domain/index.ts';
import { findRun } from '../state/queries.ts';
import type { Decider } from './decider.ts';

export function recordSilence(decider: Decider, command: CommandOf<'run.silence'>) {
  const run = decider.state.runs[command.runId];
  if (!run || run.endedAt !== null || (run.silence?.since ?? null) === command.since) return;
  decider.emit({ type: 'run.silenced', runId: run.id, since: command.since });
}

export function snoozeSilence(decider: Decider, command: CommandOf<'run.snooze_silence'>) {
  const run = findRun(decider.state, command.runId);
  if (command.until <= decider.context.now) {
    throw new DomainError('snooze_invalid', 'Snooze until a time in the future.');
  }
  if (run.silence?.snoozedUntil === command.until) return;
  decider.emit({ type: 'run.silence_snoozed', runId: run.id, until: command.until });
}

export function dismissSilence(decider: Decider, command: CommandOf<'run.dismiss_silence'>) {
  const run = findRun(decider.state, command.runId);
  if (run.silence?.dismissed) return;
  decider.emit({ type: 'run.silence_dismissed', runId: run.id });
}
