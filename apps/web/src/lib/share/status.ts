import { resolveTaskRounds, type Task } from '@shinsa/core';
import { STAGE_LABEL, STAGE_TONE } from '@/lib/format/labels.ts';
import type { Tone } from '@/lib/format/tone.ts';
import { describeRoundStatus, describeRoundTime } from '@/lib/tasks/rounds.ts';

export const STATUS_EYEBROW = 'Status';

export const STATUS_REQUEST_TITLE = 'What was asked';

export const STATUS_LATEST_TITLE = 'Latest update';

export const STATUS_ROUNDS_TITLE = 'Timeline';

export const STATUS_NO_UPDATE = 'No update yet. It appears here once the work has something to report.';

export interface StatusRound {
  number: number;
  request: string;
  status: { label: string; tone: Tone };
  time: string;
}

export interface StatusCard {
  title: string;
  stage: { label: string; tone: Tone };
  request: string;
  latest: string | null;
  rounds: StatusRound[];
}

function resolveRoundsLatest(task: Task) {
  for (const round of [...resolveTaskRounds(task)].reverse()) {
    const text = round.outcome?.headline ?? round.outcome?.result;
    if (text) return text;
  }
  return null;
}

export function resolveStatusLatest(task: Task) {
  return task.report?.headline || task.result?.body || task.summary || resolveRoundsLatest(task);
}

function listStatusRounds(task: Task, now: number): StatusRound[] {
  const rounds = resolveTaskRounds(task);
  if (rounds.length < 2) return [];
  return rounds.map((round) => ({
    number: round.number,
    request: round.request,
    status: describeRoundStatus(round),
    time: describeRoundTime(round, now),
  }));
}

export function resolveStatusCard(task: Task, now = Date.now()): StatusCard {
  return {
    title: task.title,
    stage: { label: STAGE_LABEL[task.stage], tone: STAGE_TONE[task.stage] },
    request: task.request,
    latest: resolveStatusLatest(task) || null,
    rounds: listStatusRounds(task, now),
  };
}
