import type { Schedule, WatchSource } from '../domain/index.ts';

function describeLastRead(schedule: Schedule) {
  const last = schedule.runs.filter((run) => run.outcome === 'sent').at(-1);
  if (!last) {
    return `This is its first read: look at what arrived since the automation was set up, ${new Date(schedule.createdAt).toISOString()}, or the last week when the source keeps less.`;
  }
  return `Its last read was at ${new Date(last.at).toISOString()}: look at what arrived since then.`;
}

export function resolveIntakePrompt(schedule: Schedule, source: WatchSource, note: string) {
  return [
    `Shinsa woke you for the automation “${schedule.name}”: read a data source and file a task for each new report in it.`,
    `The source: the MCP server \`${source.server}\` (${source.data}). If it was left out of this run, load it with \`load_mcp_server\` first.`,
    `What to look for: ${note}`,
    describeLastRead(schedule),
    '',
    'This read is read-only: look, do not change files or fix anything yourself.',
    'For each new report, call `file_report` with a title, the request as the human would write it, and the report itself: its id or link in the source, who wrote it, when, and its text. Shinsa refuses a report it already filed; skip it and go on.',
    'When a report is about a feature an earlier task shipped, find that task with `find_tasks` and `read_task` and set `fork_from` to it, so the new task starts from what its agent learned.',
    'A message that is not a report (a thank-you, a question already answered, chatter) is not filed.',
    'When you are done, call `report_intake` with a `summary`: what you read, what you filed and what you skipped. Then stop.',
  ].join('\n');
}
