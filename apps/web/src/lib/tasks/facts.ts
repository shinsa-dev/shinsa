import type { ShinsaState, SourceReport, Task } from '@shinsa/core';
import { formatCount } from '@/lib/format/count.ts';
import { formatMoment, formatSince } from '@/lib/format/time.ts';

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

export function selectDuplicateOriginal(state: ShinsaState, task: Task) {
  return task.duplicate ? (state.tasks[task.duplicate.of] ?? null) : null;
}

export function listDuplicates(state: ShinsaState, task: Task) {
  return Object.values(state.tasks)
    .filter((candidate) => candidate.duplicate?.of === task.id)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function describeDuplicateHint(
  duplicate: NonNullable<Task['duplicate']>,
  owner: string | null = null
) {
  if (duplicate.by === 'you') return `${owner ?? 'You'} closed this as a duplicate.`;
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
