import {
  type Task,
  WATCHDOG_DEFAULTS,
  WATCHDOG_LIMITS,
  type Watchdog,
  type WatchSource,
} from '../domain/index.ts';
import { HOUR_MS } from '../domain/time.ts';
import type { WatchdogSpec } from '../report/types.ts';
import { PROTOCOL_LIMITS } from '../report/validate.ts';

function describeHours(ms: number) {
  const hours = Math.max(1, Math.round(ms / HOUR_MS));
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

function describeLastChecks(watchdog: Watchdog) {
  const last = watchdog.checks.slice(-3);
  if (last.length === 0) return 'This is its first check.';
  return [
    'Its last checks:',
    ...last.map((check) => `- ${check.healthy ? 'Healthy' : 'Issue'}: ${check.summary}`),
  ].join('\n');
}

function describeSource(watchdog: Watchdog) {
  if (!watchdog.source) return '';
  return `Read it from the MCP server \`${watchdog.source.server}\` (${watchdog.source.data}). If it was left out of this run, load it with \`load_mcp_server\` first.`;
}

function resolveProductionPrompt(task: Task, watchdog: Watchdog) {
  const merged = task.pullRequest ? ` in pull request #${task.pullRequest.number}` : '';
  return [
    `Shinsa woke you to see whether the change you shipped${merged} is live in production yet, so the watchdog “${watchdog.title}” can start watching.`,
    `How to tell: ${watchdog.productionCheck ?? ''}`,
    'This check is read-only: look, do not change files.',
    `Report with \`report_watch\`: \`live\` false and a \`summary\` of what you saw while it is not live; Shinsa asks again in ${WATCHDOG_LIMITS.productionPollMinutes} minutes, for up to ${WATCHDOG_LIMITS.productionWaitHours} hours.`,
    `Once it is live, set \`live\` true and do the watchdog's first check in the same turn: ${watchdog.check}`,
    describeSource(watchdog),
    'Then report it as any check: `healthy`, the `summary`, and an `issue` when something is wrong that the change caused.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function resolveWatchPrompt(task: Task, watchdog: Watchdog, now: number) {
  if (watchdog.status === 'awaiting_production') return resolveProductionPrompt(task, watchdog);
  const merged = task.pullRequest ? ` in pull request #${task.pullRequest.number}` : '';
  const since = describeHours(now - (watchdog.startedAt ?? now));
  const left = describeHours((watchdog.endsAt ?? now) - now);
  return [
    `Shinsa woke you for a check of the watchdog “${watchdog.title}” on the change you shipped${merged}. It has watched for ${since}, and ${left} are left.`,
    `What to check: ${watchdog.check}`,
    describeSource(watchdog),
    describeLastChecks(watchdog),
    '',
    'This check is read-only: look, do not change files. Look only at what this watchdog is about, since the change shipped.',
    `Report what you found with \`report_watch\`: \`healthy\` true when nothing is wrong, and a \`summary\` of what you looked at and saw (at most ${PROTOCOL_LIMITS.watchSummary} characters, with the numbers).`,
    `When something is wrong that the change caused, set \`healthy\` false and add \`issue\`: a \`title\` and a \`request\` (at most ${PROTOCOL_LIMITS.watchIssueRequest} characters) written as the human would ask for the fix, with the evidence. Shinsa files it as a new task forked from this one, so its agent starts from this conversation.`,
    'A source you cannot reach is not an issue of the change: report it healthy and say so in the summary.',
  ]
    .filter(Boolean)
    .join('\n');
}

function describeKnownSource(source: WatchSource) {
  return `- \`${source.server}\`: ${source.data}`;
}

export type WatchdogDefaults = { hours: number; firstCheckMinutes: number; maxGapHours: number };

export function describeWatchdogGuide(
  sources: readonly WatchSource[],
  defaults: WatchdogDefaults = WATCHDOG_DEFAULTS
) {
  const known =
    sources.length === 0
      ? ['The project has no data sources for this repository yet.']
      : ['The data sources the project has for this repository:', ...sources.map(describeKnownSource)];
  return [
    '',
    `  \`watchdogs\` (at most ${PROTOCOL_LIMITS.watchdogs}) watch the change after it merges, when something outside the tests can show it broke: logs, traces, errors, analytics, support messages. Each has a \`title\` and a \`check\` (what to look at and what counts as an issue). Leave \`watchdogs\` out when nothing after the merge would show more than the tests did.`,
    `  Checks back off: the first comes \`first_check_minutes\` after the change is live (${defaults.firstCheckMinutes} by default), then each gap doubles up to \`max_gap_hours\` (${defaults.maxGapHours} by default), for \`for_hours\` (${defaults.hours} by default, at most ${PROTOCOL_LIMITS.watchdogForHours}). Leave them out to take the defaults, or set them from what the change needs: a payment flow or a busy API checked sooner and longer, a rarely used page less often.`,
    '  When the merge is not the release, set `starts` to `production` and give `production_check`: how to tell the merged change is live in production (the deploy platform, a release tag, a version endpoint, the production branch). Read the repository to know: a staging environment, a release branch or a manual deploy means the window should start only once it is live. Leave `starts` out when merging deploys it.',
    `  Give each one a \`source\`, an MCP server you have that holds the data (\`server\` as its name, \`data\` what it holds), or, when none does, a \`source_request\`: the \`data\` it needs, the \`evidence\` in the code of where that data goes (a file and the service), and \`suggestions\`, the servers the human could connect (an official MCP server or a provider such as Composio), up to ${PROTOCOL_LIMITS.watchdogSuggestions}. A server you name that the project does not list yet is added to its data sources.`,
    ...known.map((line) => `  ${line}`),
  ].join('\n');
}

function describeSetting(value: number | null, unit: string) {
  return value === null ? 'the default' : `${value} ${unit}`;
}

function describeWatchdogLine(watchdog: WatchdogSpec) {
  const source = watchdog.source
    ? `from ${watchdog.source.server}`
    : `needs a source: ${watchdog.sourceRequest?.data ?? ''}`;
  const start = watchdog.startsOn === 'production' ? ' once live in production' : '';
  const schedule = `first check after ${describeSetting(watchdog.firstCheckMinutes, 'min')}, gaps up to ${describeSetting(watchdog.maxGapHours, 'h')}, for ${describeSetting(watchdog.forHours, 'h')}`;
  return `- ${watchdog.title}: ${schedule}${start}, ${source}. ${watchdog.check}`;
}

export function describeWatchdogsForReview(watchdogs: readonly WatchdogSpec[]) {
  const listed =
    watchdogs.length === 0
      ? ['The agent listed no watchdogs for after the merge.']
      : ['The watchdogs the agent listed for after the merge:', ...watchdogs.map(describeWatchdogLine)];
  return [
    '',
    ...listed,
    'Check them against the change: a watchdog whose check is vague or names no number or signal is a suggestion, and so is a change that sends data somewhere (logs, analytics, an API other services call) with no watchdog on it. A source request with no evidence in the code is a finding.',
  ].join('\n');
}
