import { STAGE_WORDS } from '../chat/references.ts';
import { describeTaskName } from '../chat/text.ts';
import {
  type InitiativeMilestone,
  type InitiativeMilestoneKind,
  resolveGateDefinition,
  type Task,
} from '../domain/index.ts';
import type { ShinsaState } from '../state/project.ts';
import type { InitiativeSheet } from './types.ts';

const SETTLED_LIMIT = 10;

const MILESTONE_WORDS: Record<InitiativeMilestoneKind, string> = {
  joined: 'joined the initiative',
  plan_approved: 'had its plan approved',
  gate_opened: 'waits for the human',
  merged: 'merged',
  done: 'finished',
  cancelled: 'was cancelled',
};

function describeMember(task: Task, detail = STAGE_WORDS[task.stage]) {
  return `- ${describeTaskName(task)} (shinsa://task/${task.id}): ${detail}`;
}

function describeSection(title: string, lines: string[]) {
  return lines.length === 0 ? [] : ['', `${title}:`, ...lines];
}

function describeWaits(waitsOn: readonly Task[]) {
  if (waitsOn.length === 0) return null;
  return `waits on ${waitsOn.map((task) => task.handle ?? describeTaskName(task)).join(', ')}`;
}

export function describeInitiativeDigest(sheet: InitiativeSheet) {
  const next = sheet.next.flatMap((group) =>
    describeSection(
      group.phase ? `Next, phase ${group.phase.name}` : 'Next, no phase',
      group.tasks.map(({ task, waitsOn }) => {
        const waits = describeWaits(waitsOn);
        return describeMember(task, waits ? `${STAGE_WORDS[task.stage]}, ${waits}` : undefined);
      })
    )
  );
  const lines = [
    ...describeSection(
      'Needs the human',
      sheet.needsYou.map((entry) => describeMember(entry.task, resolveGateDefinition(entry.gate).title))
    ),
    ...describeSection(
      'Working now',
      sheet.now.map((task) => describeMember(task))
    ),
    ...next,
    ...describeSection(
      'Shipped',
      sheet.shipped.slice(0, SETTLED_LIMIT).map((task) => describeMember(task))
    ),
    ...describeSection(
      'Dropped',
      sheet.dropped.slice(0, SETTLED_LIMIT).map((entry) => describeMember(entry.task, entry.reason))
    ),
  ];
  return lines.length === 0 ? 'The initiative has no tasks yet.' : lines.join('\n').trim();
}

export function describeMilestones(state: ShinsaState, milestones: readonly InitiativeMilestone[]) {
  return milestones
    .map((milestone) => {
      const task = state.tasks[milestone.taskId];
      const name = task ? `${describeTaskName(task)} (shinsa://task/${task.id})` : 'A task';
      const text = milestone.text ? `: ${milestone.text}` : '';
      return `- ${name} ${MILESTONE_WORDS[milestone.kind]}${text}`;
    })
    .join('\n');
}
