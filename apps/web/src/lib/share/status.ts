import type { SharedTask, ShareUpdate, Task } from '@shinsa/core';
import type { Tone } from '@/lib/format/tone.ts';
import type { StepStatus } from '@/lib/overview/progress.ts';

export const STATUS_EYEBROW = 'Status';

export const STATUS_LATEST_TITLE = 'Latest update';

export const STATUS_UPDATE: Record<ShareUpdate, { label: string; tone: Tone; text: string }> = {
  planning: { label: 'Planning', tone: 'neutral', text: 'We’re planning the work.' },
  working: { label: 'In progress', tone: 'blue', text: 'We’re working on it.' },
  ready: {
    label: 'In review',
    tone: 'purple',
    text: 'The change is ready and being reviewed before it ships.',
  },
  deploying: {
    label: 'Deploying',
    tone: 'amber',
    text: 'The change is approved and on its way to production. It isn’t live yet.',
  },
  live: { label: 'Live', tone: 'green', text: 'The change is live and ready to use.' },
  looking_into: { label: 'Looking into it', tone: 'blue', text: 'We’re looking into it.' },
  answered: { label: 'Answered', tone: 'green', text: 'We’ve answered this.' },
  done: { label: 'Done', tone: 'green', text: 'This is done.' },
  closed: { label: 'Closed', tone: 'neutral', text: 'This was closed without a change.' },
};

const CHANGE_STEPS: readonly ShareUpdate[] = ['planning', 'working', 'ready', 'deploying', 'live'];

const INQUIRY_STEPS: readonly ShareUpdate[] = ['looking_into', 'answered'];

const FINAL_UPDATES: ReadonlySet<ShareUpdate> = new Set<ShareUpdate>(['live', 'answered', 'done']);

export interface StatusStep {
  key: ShareUpdate;
  label: string;
  status: StepStatus;
}

function resolvePath(update: ShareUpdate): readonly ShareUpdate[] {
  if (CHANGE_STEPS.includes(update)) return CHANGE_STEPS;
  if (INQUIRY_STEPS.includes(update)) return INQUIRY_STEPS;
  return [update];
}

function resolveStepStatus(update: ShareUpdate, index: number, current: number): StepStatus {
  if (update === 'closed') return 'cancelled';
  if (index < current || FINAL_UPDATES.has(update)) return 'done';
  return index === current ? 'current' : 'pending';
}

export function resolveStatusTimeline(update: ShareUpdate): StatusStep[] {
  const path = resolvePath(update);
  const current = path.indexOf(update);
  return path.map((key, index) => ({
    key,
    label: STATUS_UPDATE[key].label,
    status: index > current ? 'pending' : resolveStepStatus(key, index, current),
  }));
}

export interface StatusCard {
  title: string;
  stage: { label: string; tone: Tone };
  description: string | null;
  latest: string;
  timeline: StatusStep[];
}

export function resolveStatusCard(task: Task, shared: SharedTask): StatusCard {
  const key = shared.update ?? 'working';
  const update = STATUS_UPDATE[key];
  return {
    title: task.title,
    stage: { label: update.label, tone: update.tone },
    description: shared.description,
    latest: update.text,
    timeline: resolveStatusTimeline(key),
  };
}
