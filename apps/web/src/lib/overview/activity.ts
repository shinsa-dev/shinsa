import type { Activity, ShinsaState, Task } from '@shinsa/core';
import { type Mention, resolveGuestProfile, resolvePersonMention } from '@/lib/remote/users.ts';
import { resolveOwnerPossessive, type SharedOwner } from '@/lib/share/page.ts';
import { type Glyph, resolvePauseGlyph } from '@/lib/tasks/status.ts';

const ACTIVITY_GLYPH: Record<Activity['kind'], Glyph> = {
  asked: { icon: 'IconBubbleText', tone: 'neutral' },
  set_up: { icon: 'IconBranch', tone: 'neutral' },
  stage: { icon: 'IconArrowRight', tone: 'neutral' },
  plan: { icon: 'IconFileText', tone: 'purple' },
  decision: { icon: 'IconCheckCircle2', tone: 'blue' },
  work: { icon: 'IconHammer', tone: 'blue' },
  review: { icon: 'IconShieldCheck', tone: 'amber' },
  check: { icon: 'IconTestTube', tone: 'blue' },
  fix: { icon: 'IconArrowRotateClockwise', tone: 'amber' },
  pull_request: { icon: 'IconPullRequest', tone: 'green' },
  evidence: { icon: 'IconImages1', tone: 'blue' },
  message: { icon: 'IconBubbleText', tone: 'neutral' },
  note: { icon: 'IconNote1', tone: 'neutral' },
  failure: { icon: 'IconExclamationCircle', tone: 'red' },
  question: { icon: 'IconBubbleQuestion', tone: 'blue' },
  monitor: { icon: 'IconHourglass', tone: 'neutral' },
  suggestion: { icon: 'IconLightbulbGlow', tone: 'neutral' },
  answer: { icon: 'IconBubbleText', tone: 'blue' },
  account: { icon: 'IconUser', tone: 'neutral' },
  delegation: { icon: 'IconAgents', tone: 'blue' },
  shape: { icon: 'IconSplit', tone: 'purple' },
  round: { icon: 'IconArrowsRepeatCircle', tone: 'blue' },
  fork: { icon: 'IconFork', tone: 'blue' },
  watchdog: { icon: 'IconRadar', tone: 'blue' },
};

export function resolveActivityGlyph(entry: Activity): Glyph {
  if (entry.gateType === 'failure') return ACTIVITY_GLYPH[entry.kind];
  return resolvePauseGlyph(entry.gateType) ?? ACTIVITY_GLYPH[entry.kind];
}

export function listActivityDetail(entry: Activity): string[] {
  if (!entry.detail) return [];
  if (entry.kind !== 'check') return [entry.detail];
  return entry.detail.split('\n').filter((line) => line.trim() !== '');
}

export const ACTOR_LABEL: Record<Activity['actor'], string> = {
  you: 'You',
  agent: 'Agent',
  shinsa: 'Shinsa',
};

export interface ActivityActor {
  link: { label: string; taskId: string } | null;
  mention: Mention;
}

function resolveOwnActor(entry: Activity, owner: SharedOwner | null): Mention {
  if (entry.actor !== 'you' || !owner) return [ACTOR_LABEL[entry.actor]];
  return [owner.user ? { user: owner.user, label: owner.name } : owner.name];
}

export function resolveActivityActor(
  state: ShinsaState,
  entry: Activity,
  owner: SharedOwner | null = null,
  task: Task | null = null
): ActivityActor {
  if (entry.byGuest) return { link: null, mention: [{ user: resolveGuestProfile(task, entry.byGuest) }] };
  if (!entry.onBehalf) return { link: null, mention: resolveOwnActor(entry, owner) };
  const behalf = ['on ', resolveOwnerPossessive(owner), ' behalf'];
  const by = entry.byTask ? state.tasks[entry.byTask] : undefined;
  if (!by) return { link: null, mention: ['Shinsa (', ...behalf, ')'] };
  return {
    link: { label: `${by.handle ?? `“${by.title}”`} agent`, taskId: by.id },
    mention: [' (', ...behalf, ')'],
  };
}

export function resolveActivityText(entry: Activity): string | Mention {
  if (!entry.person) return entry.text;
  return resolvePersonMention(entry.text, entry.person) ?? entry.text;
}

export function resolveOverviewSummary(task: Task) {
  return task.report?.headline ?? task.summary ?? task.plan?.document?.goal ?? null;
}

export function listActivityNewestFirst(task: Task): Activity[] {
  return [...task.activity].reverse().sort((left, right) => right.at - left.at);
}
