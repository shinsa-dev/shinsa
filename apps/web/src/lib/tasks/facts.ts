import type {
  ShinsaState,
  SourceReport,
  Task,
  TeamFeedSnapshot,
  TeamFeedTask,
  TeammateOwner,
} from '@shinsa/core';
import { formatCount } from '@/lib/format/count.ts';
import { formatMoment, formatSince } from '@/lib/format/time.ts';
import { resolveSourceTaskId } from '@/lib/share/view.ts';
import { resolveTeamTaskPath, resolveTeamTaskTarget } from '@/lib/teams/feeds.ts';
import { resolveTaskPath } from '@/router.ts';

export function describeStarted(task: Task, now = Date.now()) {
  const verb = task.stage === 'waiting_on_tasks' ? 'Added' : 'Started';
  return formatSince(verb, task.createdAt, now);
}

export function describePullRequestFact(pullRequest: NonNullable<Task['pullRequest']>) {
  const notes: { text: string; tone: 'neutral' | 'red' | 'amber' }[] = [];
  if (pullRequest.state !== 'open') notes.push({ text: pullRequest.state, tone: 'neutral' });
  else if (pullRequest.checks === 'failing') notes.push({ text: 'checks failing', tone: 'red' });
  if (pullRequest.unresolvedComments > 0) {
    notes.push({ text: formatCount(pullRequest.unresolvedComments, 'comment', 'comments'), tone: 'amber' });
  }
  return notes;
}

export function listForkSources(state: ShinsaState, task: Task) {
  const source = task.forkOf ? state.tasks[task.forkOf] : undefined;
  return source ? [source] : [];
}

export interface DuplicateOriginalLink {
  owner: TeammateOwner | null;
  handle: string | null;
  title: string;
  path: string;
}

export function selectDuplicateOriginal(state: ShinsaState, task: Task): DuplicateOriginalLink | null {
  const duplicate = task.duplicate;
  if (!duplicate) return null;
  const { teammate } = duplicate;
  if (teammate) {
    return {
      owner: teammate.owner,
      handle: teammate.handle,
      title: teammate.title,
      path: resolveTeamTaskPath({
        teamId: teammate.teamId,
        instanceId: teammate.machineId,
        taskId: teammate.taskId,
      }),
    };
  }
  const original = state.tasks[duplicate.of];
  if (!original) return null;
  return {
    owner: null,
    handle: original.handle ?? null,
    title: original.title,
    path: resolveTaskPath(original),
  };
}

export function listDuplicates(state: ShinsaState, task: Task) {
  return Object.values(state.tasks)
    .filter((candidate) => candidate.duplicate?.of === task.id && !candidate.duplicate.teammate)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export interface KeptOverTeammateLink {
  key: string;
  handle: string | null;
  title: string;
  path: string;
  listing: TeamFeedTask | null;
}

export function listTeammateDuplicates(local: ShinsaState | null, feed: TeamFeedSnapshot, task: Task) {
  const id = resolveSourceTaskId(task.id);
  const isKeptOver = (candidate: Task) => candidate.duplicate?.teammate?.taskId === id;
  const own = Object.values(local?.tasks ?? {})
    .filter(isKeptOver)
    .map((candidate) => ({ task: candidate, listing: null }));
  const known = new Set(own.map((entry) => entry.task.id));
  const shared = feed.tasks
    .filter((listing) => isKeptOver(listing.task) && !known.has(listing.task.id))
    .map((listing) => ({ task: listing.task, listing }));
  return [...own, ...shared]
    .sort((a, b) => a.task.createdAt - b.task.createdAt)
    .map(
      ({ task: duplicate, listing }): KeptOverTeammateLink => ({
        key: listing ? `${listing.instanceId} ${duplicate.id}` : duplicate.id,
        handle: duplicate.handle ?? null,
        title: duplicate.title,
        path: listing ? resolveTeamTaskPath(resolveTeamTaskTarget(listing)) : resolveTaskPath(duplicate),
        listing,
      })
    );
}

export function describeDuplicateHint(
  duplicate: NonNullable<Task['duplicate']>,
  owner: string | null = null
) {
  if (duplicate.by === 'you') return `${owner ?? 'You'} closed this as a duplicate.`;
  if (duplicate.teammate) {
    const reason = duplicate.why ? ` ${duplicate.why}` : '';
    return `Shinsa closed this as a duplicate of a teammate’s task, which you can only view.${reason}`;
  }
  return duplicate.why
    ? `Shinsa closed this as a duplicate: ${duplicate.why}`
    : 'Shinsa closed this as a duplicate.';
}

export function listForks(state: ShinsaState, task: Task) {
  return Object.values(state.tasks)
    .filter((candidate) => candidate.forkOf === task.id)
    .sort((a, b) => a.createdAt - b.createdAt);
}

function describePostedAt(postedAt: string | null, now: number) {
  if (postedAt === null) return null;
  const at = Date.parse(postedAt);
  return Number.isNaN(at) ? postedAt : formatMoment(at, now);
}

function isWebLink(link: string | null): link is string {
  return link !== null && /^https?:\/\//i.test(link);
}

function resolveFiledBy(state: ShinsaState, task: Task, report: SourceReport) {
  const schedule = report.scheduleId ? state.schedules[report.scheduleId] : undefined;
  if (schedule)
    return {
      label: 'Filed by the automation',
      value: schedule.name,
      watchId: schedule.id,
      watchedTaskId: null,
    };
  const watched = report.watchdogId && task.forkOf ? state.tasks[task.forkOf] : undefined;
  const watchdog = watched?.watchdogs?.find((candidate) => candidate.id === report.watchdogId);
  if (!watched || !watchdog) return null;
  return { label: 'Filed by the watchdog', value: watchdog.title, watchId: null, watchedTaskId: watched.id };
}

export function resolveReportFact(state: ShinsaState, task: Task, now = Date.now()) {
  const report = task.sourceReport;
  if (!report) return null;
  const byline = [report.author, describePostedAt(report.postedAt, now)].filter(Boolean).join(' · ');
  return {
    label: `Reported in ${report.server}`,
    byline: byline || null,
    text: report.text,
    link: isWebLink(report.link) ? report.link : null,
    filedBy: resolveFiledBy(state, task, report),
  };
}
