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
import { resolveReadPrompt } from './reads.ts';

function describeHours(ms: number) {
  const hours = Math.max(1, Math.round(ms / HOUR_MS));
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

function describeLastChecks(watchdog: Watchdog) {
  const last = watchdog.checks.slice(-3);
  if (last.length === 0) return ['This is its first check.'];
  return [
    'Its last checks:',
    ...last.map((check) => `- ${check.healthy ? 'Healthy' : 'Issue'}: ${check.summary}`),
  ];
}

function describeSince(watchdog: Watchdog) {
  const last = watchdog.checks.at(-1)?.at ?? watchdog.startedAt;
  if (watchdog.status === 'awaiting_production' || last === null) {
    return 'Look only at what arrived since the change went live.';
  }
  return `Look only at what arrived since ${new Date(last).toISOString()}.`;
}

function resolveWatchOpening(task: Task, watchdog: Watchdog, now: number) {
  const merged = task.pullRequest ? ` in pull request #${task.pullRequest.number}` : '';
  if (watchdog.status === 'awaiting_production') {
    return [
      `Shinsa woke you to see whether the change you shipped${merged} is live in production yet, so the watchdog “${watchdog.title}” can start watching.`,
      `How to tell: ${watchdog.productionCheck ?? ''}`,
      `While it is not live, call \`report_read\` with \`live\` false and a \`summary\` of what you saw, and file nothing. Your answer counts for every watchdog of this task that waits for production. Shinsa asks again later, less often the longer it waits (from every ${WATCHDOG_LIMITS.productionPollMinutes} minutes to every ${WATCHDOG_LIMITS.productionPollMaxMinutes / 60} hours), for up to ${WATCHDOG_LIMITS.productionWaitHours} hours.`,
      'Once it is live, do the watchdog’s first check in the same turn, as below, and end it with `live` true.',
    ];
  }
  const since = describeHours(now - (watchdog.startedAt ?? now));
  const left = describeHours((watchdog.endsAt ?? now) - now);
  return [
    `Shinsa woke you for a check of the watchdog “${watchdog.title}” on the change you shipped${merged}. It has watched for ${since}, and ${left} are left.`,
  ];
}

export function resolveWatchPrompt(task: Task, watchdog: Watchdog, now: number, filed: readonly Task[]) {
  const source = watchdog.source ?? { server: '', data: '' };
  const live = watchdog.status === 'awaiting_production' ? ' with `live` true' : '';
  return resolveReadPrompt({
    opening: resolveWatchOpening(task, watchdog, now),
    source,
    lookFor: watchdog.check,
    since: describeSince(watchdog),
    context: describeLastChecks(watchdog),
    filed,
    filing: [
      'A report here is something wrong that the change caused: an error, a broken signal, a number past what the check allows. Look only at what this watchdog is about.',
      'Every task you file forks this one, so its agent starts from this conversation: leave `fork_from` out. `repository` defaults to this task’s.',
      'When what you found has no id of its own (a latency, a rate), give the `link` of the query or dashboard that shows it, and the numbers in `text`.',
    ],
    missed: 'Shinsa counts the check as missed and checks again at the next one.',
    ending: `When you are done, call \`report_read\`${live} with a \`summary\` of what you looked at and saw, with the numbers. A check that filed nothing is healthy; one that filed a report trips the watchdog, which then stops. Then stop.`,
  });
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
    '  Give each one a `source` (`server` as its name, `data` what it reads there) from any MCP server you have, not only the data sources below: list them all with `mcp_list` and load one with `load_mcp_server`. A data source’s description is a hint, not a limit: one account often reaches more than it says.',
    '  Before you decide no server holds the data, check every server that could, with its own tools: list the Workers, projects or services it sees, or query the logs of the one the change touches. Give the server that reaches the data as the `source` even when its description says less.',
    `  Only when no server you have reaches the data, give a \`source_request\`: the \`data\` it needs, the \`evidence\` in the code of where that data goes (a file and the service) and which servers you checked and why each cannot reach it, and \`suggestions\`, the servers the human could connect (an official MCP server or a provider such as Composio), up to ${PROTOCOL_LIMITS.watchdogSuggestions}. Shinsa refuses a suggestion of a server you already have unless \`evidence\` names it and says why it falls short. A server you name as a \`source\` that the project does not list yet is added to its data sources, and one it lists is widened to what you read there.`,
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
    'Check them against the change: a watchdog whose check is vague or names no number or signal is `should_fix`, and so is a change that sends data somewhere (logs, analytics, an API other services call) with no watchdog on it. A source request with no evidence in the code is a finding.',
  ].join('\n');
}
