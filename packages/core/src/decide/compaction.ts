import type { CommandOf } from '../commands/index.ts';
import type { Decider } from './decider.ts';

export function recordCompaction(decider: Decider, command: CommandOf<'run.compact'>) {
  const run = decider.state.runs[command.runId];
  if (!run || run.endedAt === null || run.sessionId !== command.sessionId) return;
  if (run.compactions?.includes(command.sessionId)) return;
  decider.emit({ type: 'run.compacted', runId: run.id, sessionId: command.sessionId });
}
