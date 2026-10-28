import {
  type Activity,
  type Gate,
  resolveCurrentRound,
  type Task,
  type WatchdogStatus,
} from '../domain/index.ts';
import { resolveRequest } from '../prompts/context.ts';
import { listWaitsOn } from '../queue/rank.ts';
import { assembleReport } from '../report/assemble.ts';
import { listMergeSteps, MERGE_STEP_WHEN_WORDS } from '../report/merge-steps.ts';
import { listTestingLines } from '../report/testing.ts';
import type { ShinsaState } from '../state/project.ts';
import { listOpenGates } from '../state/queries.ts';
import { describeCoverage } from '../test-coverage/describe.ts';
import { STAGE_WORDS, serializeReference } from './references.ts';
import { describeCount } from './text.ts';

const REQUEST_LIMIT = 1_500;

const BODY_LIMIT = 400;

const ACTIVITY_SHOWN = 10;

const ACTOR_WORDS: Record<Activity['actor'], string> = { you: 'the human', agent: 'agent', shinsa: 'Shinsa' };

function cut(text: string, limit: number) {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function describeLink(task: Task) {
  return `[${task.title}](${serializeReference({ kind: 'task', id: task.id })})`;
}

function describeHeader(state: ShinsaState, task: Task) {
  const repo = task.repoId ? state.repos[task.repoId] : undefined;
  const project = task.projectId ? state.projects[task.projectId] : undefined;
  const pullRequest = task.pullRequest;
  return [
    `${describeLink(task)} · ${STAGE_WORDS[task.stage]}${task.stageReason ? ` (${task.stageReason})` : ''}`,
    `${task.handle ? `${task.handle} · ` : ''}id ${task.id} · priority ${task.priority}${task.mode === 'ask' ? ' · answers a question' : ''}`,
    [
      project ? `project ${project.name}` : '',
      repo ? `repository ${repo.name}` : '',
      task.branch ? `branch ${task.branch}` : '',
      pullRequest
        ? `pull request #${pullRequest.number} ${pullRequest.state}, checks ${pullRequest.checks}`
        : '',
    ]
      .filter(Boolean)
      .join(' · '),
  ].filter(Boolean);
}

function describePlan(task: Task) {
  const document = task.plan?.document;
  if (!task.plan || !document) return [];
  const approved = task.plan.approvedAt ? ', approved' : '';
  return [
    `Plan (version ${task.plan.version}${approved}): ${document.goal}`,
    ...document.phases.map(
      (step, index) => `  ${index + 1}. ${step.title} (${task.phases[index]?.status ?? 'pending'})`
    ),
  ];
}

function describeGate(gate: Gate) {
  const choices = gate.choices && gate.choices.length > 0 ? ` Choices: ${gate.choices.join(' | ')}.` : '';
  return `- ${gate.title} (gate ${gate.id}, ${gate.type}): ${cut(gate.body, BODY_LIMIT)}${choices}`;
}

function describeMergeSteps(task: Task) {
  const steps = listMergeSteps(task);
  if (steps.length === 0) return [];
  return [
    'Steps for the human around the merge (only the human ticks them):',
    ...steps.map((step, index) => {
      const command = step.command ? `: \`${step.command}\`` : '';
      return `  ${index + 1}. [${step.done ? 'x' : ' '}] ${MERGE_STEP_WHEN_WORDS[step.when]}, ${step.kind}: ${step.title}${command}`;
    }),
  ];
}

const WATCHDOG_STATE: Record<WatchdogStatus, string> = {
  needs_source: 'waits for a data source',
  awaiting_production: 'waits for the change to reach production',
  watching: 'watching',
  passed: 'passed',
  tripped: 'found an issue',
  stopped: 'stopped',
};

function describeWatchdogs(task: Task) {
  const watchdogs = task.watchdogs ?? [];
  if (watchdogs.length === 0) return [];
  return [
    'Watchdogs on the merged change:',
    ...watchdogs.map((watchdog, index) => {
      const source = watchdog.source ? ` from ${watchdog.source.server}` : '';
      const checks = describeCount(watchdog.checks.length, 'check');
      return `  ${index + 1}. ${watchdog.title}${source} (${WATCHDOG_STATE[watchdog.status]}, ${checks}): ${watchdog.check}`;
    }),
  ];
}

function describeTesting(task: Task) {
  const lines = listTestingLines(assembleReport(task).walkthrough?.testing);
  if (lines.length === 0) return [];
  return ['How to test the change:', ...lines.map((line) => `  ${line}`)];
}

function describeTestCoverage(task: Task) {
  const summary = describeCoverage(task.coverage);
  return summary ? [`Changed-line coverage: ${summary}.`] : [];
}

function describeRequest(task: Task) {
  const round = resolveCurrentRound(task).number;
  const label = round > 1 ? `Request (round ${round})` : 'Request';
  return `${label}: ${cut(resolveRequest(task), REQUEST_LIMIT)}`;
}

function describeActivity(state: ShinsaState, entry: Activity) {
  const from = entry.byTask ? state.tasks[entry.byTask] : undefined;
  const agent = from
    ? `the agent of ${from.handle ?? `"${from.title}"`} for the human`
    : 'Shinsa for the human';
  const who = entry.onBehalf ? agent : ACTOR_WORDS[entry.actor];
  return `- ${new Date(entry.at).toISOString()} ${who}: ${entry.text}`;
}

export function serializeTaskDetail(state: ShinsaState, taskId: string) {
  const task = state.tasks[taskId];
  if (!task) return `No task ${taskId}. \`find_tasks\` lists the tasks.`;
  const gates = listOpenGates(state, task.id);
  const waits = listWaitsOn(state, task);
  return [
    ...describeHeader(state, task),
    describeRequest(task),
    ...describePlan(task),
    ...(task.summary ? [`Summary: ${task.summary}`] : []),
    ...(task.result ? [`Result (${task.result.step}): ${cut(task.result.body, REQUEST_LIMIT)}`] : []),
    ...describeTesting(task),
    ...describeTestCoverage(task),
    ...describeMergeSteps(task),
    ...describeWatchdogs(task),
    ...(waits.length > 0 ? [`Waits on: ${waits.map(describeLink).join(', ')}`] : []),
    ...(gates.length > 0 ? ['Open decisions:', ...gates.map(describeGate)] : ['No open decisions.']),
    'Recent activity:',
    ...task.activity.slice(-ACTIVITY_SHOWN).map((entry) => describeActivity(state, entry)),
  ].join('\n');
}
