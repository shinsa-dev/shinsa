import { resolveTaskRounds, type Task } from '@shinsa/core';
import { STAGE_LABEL, STAGE_TONE } from '@/lib/format/labels.ts';
import type { Tone } from '@/lib/format/tone.ts';

export const STATUS_EYEBROW = 'Status';

export const STATUS_LATEST_TITLE = 'Latest update';

export const STATUS_NO_UPDATE = 'No update yet. It appears here once the work has something to report.';

export interface StatusCard {
  title: string;
  stage: { label: string; tone: Tone };
  description: string | null;
  latest: string | null;
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

export function resolveStatusCard(task: Task): StatusCard {
  return {
    title: task.title,
    stage: { label: STAGE_LABEL[task.stage], tone: STAGE_TONE[task.stage] },
    description: task.plan?.document?.goal || null,
    latest: resolveStatusLatest(task) || null,
  };
}
