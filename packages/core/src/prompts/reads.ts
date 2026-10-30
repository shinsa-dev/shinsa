import type { ReportFiling } from '../commands/index.ts';
import { SCHEDULE_LIMITS, type Task } from '../domain/index.ts';

interface ReadPrompt {
  opening: string[];
  source: { server: string; data: string };
  lookFor: string;
  since: string;
  context: string[];
  filed: readonly Task[];
  filing: string[];
  missed: string;
  ending: string;
}

function describeFiled(filed: readonly Task[]) {
  if (filed.length === 0) return [];
  const lines = filed.map((task) => {
    const report = task.sourceReport;
    const where = report?.link ?? report?.reportId ?? '';
    return `- ${task.handle ?? task.id} “${task.title}”: ${where}`;
  });
  return ['The reports filed last from this source, newest first:', ...lines];
}

export function resolveReadPrompt(read: ReadPrompt) {
  return [
    ...read.opening,
    `The source: the MCP server \`${read.source.server}\` (${read.source.data}). If it was left out of this run, load it with \`load_mcp_server\` first.`,
    `What to look for: ${read.lookFor}`,
    read.since,
    ...read.context,
    ...describeFiled(read.filed),
    '',
    'This read is read-only: look, do not change files or fix anything yourself.',
    'For each new report, call `file_report` with a title, the request as the human would write it, and the report itself: its id or link in the source, who wrote it, when, and its text. Shinsa refuses a report it already filed; skip it and go on.',
    ...read.filing,
    `When the source errors or times out, wait a little and try again, ${SCHEDULE_LIMITS.readAttempts} tries in all. If it still fails, call \`report_read\` with \`reached\` false and a \`summary\` of what failed: ${read.missed}`,
    read.ending,
  ].join('\n');
}

function quote(text: string) {
  return text
    .split('\n')
    .map((line) => `> ${line}`.trimEnd())
    .join('\n');
}

export function resolveFiledRequest(filing: ReportFiling, server: string) {
  const author = filing.author ? ` by ${filing.author}` : '';
  const posted = filing.postedAt ? ` on ${filing.postedAt}` : '';
  const where = filing.link ?? `id ${filing.reportId ?? ''}`;
  return [
    filing.title,
    '',
    filing.request,
    '',
    `Reported in ${server}${author}${posted} (${where}):`,
    '',
    quote(filing.text),
  ].join('\n');
}
