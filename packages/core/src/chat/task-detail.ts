import { type Activity, type Gate, resolveCurrentRound, type Task } from '../domain/index.ts';
import { resolveRequest } from '../prompts/context.ts';
import { listWaitsOn } from '../queue/rank.ts';
import type { ShinsaState } from '../state/project.ts';
import { listOpenGates } from '../state/queries.ts';
import { STAGE_WORDS, serializeReference } from './references.ts';

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
    ...(waits.length > 0 ? [`Waits on: ${waits.map(describeLink).join(', ')}`] : []),
    ...(gates.length > 0 ? ['Open decisions:', ...gates.map(describeGate)] : ['No open decisions.']),
    'Recent activity:',
    ...task.activity.slice(-ACTIVITY_SHOWN).map((entry) => describeActivity(state, entry)),
  ].join('\n');
}
