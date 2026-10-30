import type { Schedule, Task, WatchSource } from '../domain/index.ts';
import { resolveReadPrompt } from './reads.ts';

function describeLastRead(schedule: Schedule) {
  if (schedule.lastReadAt === null) {
    return `No read has finished yet: look at what arrived since the automation was set up, ${new Date(schedule.createdAt).toISOString()}, or the last week when the source keeps less.`;
  }
  return `Its last finished read started at ${new Date(schedule.lastReadAt).toISOString()}: look at what arrived since then.`;
}

export function resolveIntakePrompt(
  schedule: Schedule,
  source: WatchSource,
  note: string,
  filed: readonly Task[]
) {
  return resolveReadPrompt({
    opening: [
      `Shinsa woke you for the automation “${schedule.name}”: read a data source and file a task for each new report in it.`,
    ],
    source,
    lookFor: note,
    since: describeLastRead(schedule),
    context: [],
    filed,
    filing: [
      'When a report is about a feature an earlier task shipped, find that task with `find_tasks` and `read_task` and set `fork_from` to it, so the new task starts from what its agent learned.',
      'Set `repository` when you know which repository the report is about; otherwise Shinsa picks one in the project.',
      'A message that is not a report (a thank-you, a question already answered, chatter) is not filed.',
    ],
    missed: 'the next read starts from where this one should have, so nothing is missed.',
    ending:
      'When you are done, call `report_read` with a `summary`: what you read, what you filed and what you skipped. Then stop.',
  });
}
