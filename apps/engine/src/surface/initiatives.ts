import {
  describePhaseProgress,
  DomainError,
  type InitiativePhase,
  selectInitiativeByReference,
} from '@shinsa/core';
import type {
  InitiativeSheetView,
  InitiativeTaskRef,
  InitiativeView,
  TaskView,
} from '@shinsa/core/engine-api/schema';
import { Effect, Option } from 'effect';
import type { FieldSpec, Values } from './fields.ts';
import { findTaskId } from './resolve.ts';
import type { SurfaceClient } from './schema.ts';
import { defineCommand, defineRead, readValue, type SurfaceSpec } from './spec.ts';

const INITIATIVE_FIELD: FieldSpec = {
  name: 'initiative',
  kind: 'text',
  positional: 'one',
  required: true,
  description: 'The initiative: its name, its id or the start of its id.',
};

const TASK_FIELD: FieldSpec = {
  name: 'task',
  kind: 'text',
  positional: 'one',
  required: true,
  description: 'The task: its handle (SW-142), its id, the start of its id, or its exact title.',
};

export const findInitiative = Effect.fn('Surface.findInitiative')(function* (
  client: SurfaceClient,
  ref: string
) {
  const { initiatives } = yield* client.api.state.initiatives();
  const initiative = Option.getOrNull(selectInitiativeByReference(initiatives, ref));
  if (!initiative) {
    return yield* new DomainError({
      code: 'initiative_not_found',
      message: `No initiative ${ref}. \`shinsa initiatives list\` lists them.`,
    });
  }
  return initiative;
});

function selectPhase(phases: readonly InitiativePhase[], ref: string) {
  const lower = ref.trim().toLowerCase();
  return phases.find((phase) => phase.id === ref || phase.name.toLowerCase() === lower) ?? null;
}

const findPhaseId = Effect.fn('Surface.findInitiativePhaseId')(function* (
  initiative: InitiativeView,
  ref: string
) {
  if (!ref) return null;
  const phase = selectPhase(initiative.phases, ref);
  if (phase) return phase.id;
  const names = initiative.phases.map((candidate) => candidate.name).join(', ');
  return yield* new DomainError({
    code: 'initiative_phase_not_found',
    message: names
      ? `${initiative.name} has no phase ${ref}. Its phases are ${names}.`
      : `${initiative.name} has no phases yet. Add them with \`shinsa initiatives write --id\`.`,
  });
});

function describeProgress(initiative: InitiativeView) {
  const shipped = initiative.progress.reduce((sum, phase) => sum + phase.shipped, 0);
  const tasks = initiative.members === 1 ? '1 task' : `${initiative.members} tasks`;
  const lead = initiative.lead ? `, led by ${describeTaskRef(initiative.lead)}` : '';
  return `${tasks}, ${shipped} shipped${lead}`;
}

function describeInitiative(initiative: InitiativeView) {
  return `${initiative.name}  (${initiative.id}) ${describeProgress(initiative)}`;
}

function describeTaskRef(task: InitiativeTaskRef | TaskView) {
  return task.handle ?? task.id;
}

function describeTask(task: TaskView) {
  const pullRequest = task.pullRequest ? `, #${task.pullRequest.number}` : '';
  return `${describeTaskRef(task)}  ${task.title} (${task.status}${pullRequest})`;
}

function describeSection(title: string, lines: string[]) {
  return lines.length === 0 ? [] : ['', `${title}:`, ...lines.map((line) => `  ${line}`)];
}

function describeNext(sheet: InitiativeSheetView) {
  return sheet.next.flatMap((group) =>
    describeSection(
      group.phase ? `Next, ${group.phase.name}` : 'Next, no phase',
      group.tasks.map(({ task, waitsOn }) => {
        const waits = waitsOn.length > 0 ? `, waits on ${waitsOn.map(describeTaskRef).join(', ')}` : '';
        return `${describeTask(task)}${waits}`;
      })
    )
  );
}

function describeReport(sheet: InitiativeSheetView) {
  if (!sheet.report) return [];
  return ['', 'From the lead:', ...sheet.report.narrative.split('\n').map((line) => `  ${line}`)];
}

function describeInitiativeSheet(sheet: InitiativeSheetView) {
  const { initiative } = sheet;
  const phases = initiative.progress.map((phase) => {
    const { name, detail } = describePhaseProgress(phase);
    return `${name}: ${detail}`;
  });
  return [
    `${initiative.name}, ${describeProgress(initiative)}`,
    initiative.description || 'No description.',
    ...describeReport(sheet),
    ...describeSection('Phases', phases),
    ...describeSection(
      'Needs you',
      sheet.needsYou.map((entry) => `${describeTask(entry.task)}: ${entry.reason}`)
    ),
    ...describeSection('Now', sheet.now.map(describeTask)),
    ...describeNext(sheet),
    ...describeSection('Shipped', sheet.shipped.map(describeTask)),
    ...describeSection(
      'Dropped',
      sheet.dropped.map((entry) => `${describeTask(entry.task)}: ${entry.reason}`)
    ),
    ...describeSection(
      'Decisions',
      sheet.decisions.map(
        (decision) =>
          `${describeTaskRef(decision.task)} ${decision.kind === 'plan' ? 'plan' : 'call'}: ${decision.text}`
      )
    ),
    '',
    initiative.url,
  ].join('\n');
}

function resolvePhaseInputs(phases: readonly InitiativePhase[], names: string[]) {
  return names.map((name) => ({ id: selectPhase(phases, name)?.id ?? null, name }));
}

function readList(values: Values, name: string) {
  const value = values[name];
  return Array.isArray(value) ? value.map(String) : null;
}

const buildWrite = Effect.fn('Surface.initiativesWrite')(function* (values: Values, client: SurfaceClient) {
  const existing = yield* findInitiative(client, readValue(values, 'initiative'));
  const names = readList(values, 'phases');
  const description = typeof values.description === 'string' ? values.description : undefined;
  const name = readValue(values, 'name');
  return {
    type: 'initiative.write' as const,
    initiativeId: existing.id,
    name: name || existing.name,
    ...(description === undefined ? {} : { description }),
    ...(names ? { phases: resolvePhaseInputs(existing.phases, names) } : {}),
  };
});

const buildJoin = Effect.fn('Surface.tasksJoinInitiative')(function* (values: Values, client: SurfaceClient) {
  const initiative = yield* findInitiative(client, readValue(values, 'initiative'));
  return {
    type: 'task.join_initiative' as const,
    taskId: yield* findTaskId(client, readValue(values, 'task')),
    initiativeId: initiative.id,
    phaseId: yield* findPhaseId(initiative, readValue(values, 'phase')),
  };
});

export const INITIATIVE_SPECS: SurfaceSpec[] = [
  defineRead({
    path: ['initiatives', 'list'],
    summary: 'List the initiatives: groups of tasks above projects, each with its phases and progress.',
    fields: [],
    read: (_values, client) => client.api.state.initiatives(),
    format: ({ initiatives }) =>
      initiatives.length === 0 ? 'No initiatives yet.' : initiatives.map(describeInitiative).join('\n'),
  }),
  defineRead({
    path: ['initiatives', 'show'],
    summary:
      'Show an initiative’s sheet: what needs you, what is being worked on, what comes next by phase, what shipped or was dropped, and the decisions made.',
    fields: [INITIATIVE_FIELD],
    read: (values, client) =>
      client.api.state.initiative({ params: { initiativeRef: readValue(values, 'initiative') } }),
    format: describeInitiativeSheet,
  }),
  defineCommand({
    path: ['initiatives', 'write'],
    summary:
      'Change an initiative’s name, description or phases. Start one with `shinsa tasks create --initiative`.',
    command: 'initiative.write',
    fields: [
      INITIATIVE_FIELD,
      { name: 'name', kind: 'text', description: 'Its new name. Left out, it keeps the one it has.' },
      {
        name: 'description',
        kind: 'text',
        description: 'What the initiative is for. Left out, it keeps the one it has.',
      },
      {
        name: 'phases',
        kind: 'list',
        description:
          'Its phases in order, replacing the ones it has. A phase keeps its tasks while its name stays; tasks in a phase you leave out keep no phase. Left out, it keeps them.',
      },
    ],
    build: buildWrite,
    done: () => 'Changed.',
  }),
  defineCommand({
    path: ['initiatives', 'adopt'],
    summary:
      'Make an initiative from a task: named after it, holding the task and every task it filed, split off or forked, and theirs in turn, with a lead forked from its conversation.',
    command: 'initiative.adopt_task',
    fields: [TASK_FIELD],
    build: Effect.fn('Surface.initiativesAdopt')(function* (values, client) {
      return {
        type: 'initiative.adopt_task' as const,
        taskId: yield* findTaskId(client, readValue(values, 'task')),
      };
    }),
    done: () => 'Made the initiative.',
  }),
  defineCommand({
    path: ['tasks', 'join-initiative'],
    summary:
      'Add a task to an initiative, or move it to another phase. Tasks it files later join the same initiative and phase.',
    command: 'task.join_initiative',
    fields: [
      TASK_FIELD,
      INITIATIVE_FIELD,
      { name: 'phase', kind: 'text', description: 'The phase, by name or id. Left out, no phase.' },
    ],
    build: buildJoin,
    done: () => 'Added.',
  }),
  defineCommand({
    path: ['tasks', 'leave-initiative'],
    summary: 'Take a task out of its initiative.',
    command: 'task.join_initiative',
    fields: [TASK_FIELD],
    build: Effect.fn('Surface.tasksLeaveInitiative')(function* (values, client) {
      return {
        type: 'task.join_initiative' as const,
        taskId: yield* findTaskId(client, readValue(values, 'task')),
        initiativeId: null,
        phaseId: null,
      };
    }),
    done: () => 'Taken out.',
  }),
];
