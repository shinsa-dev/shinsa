import type { SharedTask, ShareUpdate, Task } from '@shinsa/core';
import type { Tone } from '@/lib/format/tone.ts';

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

export interface StatusCard {
  title: string;
  stage: { label: string; tone: Tone };
  description: string | null;
  latest: string;
}

export function resolveStatusCard(task: Task, shared: SharedTask): StatusCard {
  const update = STATUS_UPDATE[shared.update ?? 'working'];
  return {
    title: task.title,
    stage: { label: update.label, tone: update.tone },
    description: shared.description,
    latest: update.text,
  };
}
