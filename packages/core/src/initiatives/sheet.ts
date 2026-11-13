import { Option } from 'effect';

import { capitalise, quoteTitle } from '../chat/text.ts';
import {
  compareTasks,
  type Initiative,
  isLeadTask,
  type InitiativeTeamMember,
  isTaskSettled,
  NO_FOCUS,
  RUN_STAGES,
  type Task,
  type TaskStage,
} from '../domain/index.ts';
import { listWaitsOn, resolveQueue } from '../queue/rank.ts';
import { listInitiativeWork } from '../state/initiatives.ts';
import type { ShinsaState } from '../state/project.ts';
import { listBundleBlockers } from '../state/queries.ts';
import type {
  InitiativeDecision,
  InitiativeDroppedTask,
  InitiativePhaseGroup,
  InitiativePhaseProgress,
  InitiativeSheet,
  InitiativeTeammateSection,
  InitiativeTeammateTask,
} from './types.ts';

const DECISION_LIMIT = 100;

function resolvePhaseOrder(initiative: Initiative) {
  return [...initiative.phases.map((phase) => phase.id), null];
}

interface PhasedMember {
  stage: TaskStage;
  phaseId: string | null;
}

function resolvePhaseId(initiative: Initiative, phaseId: string | null) {
  return initiative.phases.some((phase) => phase.id === phaseId) ? phaseId : null;
}

function resolvePhaseKey(initiative: Initiative, task: Task) {
  return resolvePhaseId(initiative, task.initiativePhaseId ?? null);
}

function listPhasedMembers(initiative: Initiative, members: readonly Task[]): PhasedMember[] {
  return [
    ...members.map((task) => ({ stage: task.stage, phaseId: resolvePhaseKey(initiative, task) })),
    ...(initiative.teamMembers ?? []).map((member) => ({
      stage: member.stage,
      phaseId: resolvePhaseId(initiative, member.phaseId),
    })),
  ];
}

function selectPhase(initiative: Initiative, phaseId: string | null) {
  return initiative.phases.find((phase) => phase.id === phaseId) ?? null;
}

function listNext(state: ShinsaState, initiative: Initiative, tasks: Task[]): InitiativePhaseGroup[] {
  return resolvePhaseOrder(initiative).flatMap((phaseId) => {
    const members = tasks.filter((task) => resolvePhaseKey(initiative, task) === phaseId).sort(compareTasks);
    if (members.length === 0) return [];
    return [
      {
        phase: selectPhase(initiative, phaseId),
        tasks: members.map((task) => ({
          task,
          waitsOn: [...listWaitsOn(state, task), ...listBundleBlockers(state, task)],
        })),
      },
    ];
  });
}

function listProgress(initiative: Initiative, members: Task[]): InitiativePhaseProgress[] {
  const phased = listPhasedMembers(initiative, members);
  return resolvePhaseOrder(initiative).flatMap((phaseId) => {
    const tasks = phased.filter((member) => member.phaseId === phaseId);
    if (tasks.length === 0 && phaseId === null) return [];
    const dropped = tasks.filter((task) => task.stage === 'cancelled').length;
    const shipped = tasks.filter((task) => isTaskSettled(task)).length - dropped;
    return [{ phase: selectPhase(initiative, phaseId), total: tasks.length, shipped, dropped }];
  });
}

function resolveDropReason(state: ShinsaState, task: Task) {
  const original = task.duplicate ? state.tasks[task.duplicate.of] : undefined;
  if (original) return `Duplicate of ${quoteTitle(original.title)}`;
  return capitalise(task.stageReason ?? 'cancelled');
}

function listTaskDecisions(task: Task): InitiativeDecision[] {
  const rounds = (task.rounds ?? []).flatMap((round) => {
    const goal = round.outcome?.goal;
    if (!goal) return [];
    return [
      {
        taskId: task.id,
        kind: 'plan' as const,
        title: round.title,
        text: goal,
        at: round.endedAt ?? round.queuedAt,
      },
    ];
  });
  const plan = task.plan;
  const current =
    plan?.approvedAt && plan.document
      ? [
          {
            taskId: task.id,
            kind: 'plan' as const,
            title: task.title,
            text: plan.document.goal,
            at: plan.approvedAt,
          },
        ]
      : [];
  const calls = task.phaseReports.flatMap((report) =>
    report.judgementCalls.map((call) => ({
      taskId: task.id,
      kind: 'call' as const,
      title: call.title,
      text: call.call,
      at: report.at,
    }))
  );
  return [...rounds, ...current, ...calls];
}

function resolveTeammateSection(member: InitiativeTeamMember): InitiativeTeammateSection {
  if (member.stage === 'cancelled') return 'dropped';
  if (isTaskSettled(member)) return 'shipped';
  if (member.gate) return 'owner';
  return RUN_STAGES.has(member.stage) ? 'now' : 'next';
}

function listTeammates(initiative: Initiative): InitiativeTeammateTask[] {
  const order = resolvePhaseOrder(initiative);
  return (initiative.teamMembers ?? [])
    .map((member) => {
      const phaseId = resolvePhaseId(initiative, member.phaseId);
      return { member, phase: selectPhase(initiative, phaseId), section: resolveTeammateSection(member) };
    })
    .sort(
      (left, right) =>
        order.indexOf(left.phase?.id ?? null) - order.indexOf(right.phase?.id ?? null) ||
        (left.member.handle ?? left.member.title).localeCompare(right.member.handle ?? right.member.title)
    );
}

function compareByRecent(left: Task, right: Task) {
  return (
    (right.closedAt ?? right.updatedAt) - (left.closedAt ?? left.updatedAt) || left.id.localeCompare(right.id)
  );
}

export function resolveInitiativeSheet(
  state: ShinsaState,
  initiativeId: string,
  now: number
): Option.Option<InitiativeSheet> {
  const initiative = state.initiatives[initiativeId];
  if (!initiative) return Option.none();
  const members = listInitiativeWork(state, initiativeId);
  const queue = resolveQueue({ ...state, focus: { ...NO_FOCUS, initiativeId } }, now);
  const needsYou = queue.ready.filter((entry) => !isLeadTask(entry.task));
  const workingTasks = queue.working.filter((task) => !isLeadTask(task));
  const deciding = new Set(needsYou.map((entry) => entry.task.id));
  const working = new Set(workingTasks.map((task) => task.id));
  const open = members.filter(
    (task) => !isTaskSettled(task) && !deciding.has(task.id) && !working.has(task.id)
  );
  const dropped: InitiativeDroppedTask[] = members
    .filter((task) => task.stage === 'cancelled')
    .sort(compareByRecent)
    .map((task) => ({ task, reason: resolveDropReason(state, task) }));
  const decisions = members
    .flatMap(listTaskDecisions)
    .sort((left, right) => right.at - left.at || left.taskId.localeCompare(right.taskId))
    .slice(0, DECISION_LIMIT);
  return Option.some({
    initiative,
    needsYou,
    now: workingTasks,
    next: listNext(state, initiative, open),
    shipped: members
      .filter((task) => isTaskSettled(task) && task.stage !== 'cancelled')
      .sort(compareByRecent),
    dropped,
    decisions,
    progress: listProgress(initiative, members),
    teammates: listTeammates(initiative),
  });
}

export function listInitiativeProgress(state: ShinsaState, initiative: Initiative) {
  return listProgress(initiative, listInitiativeWork(state, initiative.id));
}
