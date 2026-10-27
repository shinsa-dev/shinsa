import type { FindingVerdict, GateDecision, GateType, UserCommand } from '@shinsa/core';
import type { SurfaceClient } from './client.ts';
import type { FieldSpec, Values } from './fields.ts';
import { findOpenGate } from './resolve.ts';
import { defineAction, defineCommand, encode, readValue, type SurfaceSpec } from './spec.ts';
import { TASK_FIELD } from './tasks.ts';

const DECISIONS = ['approve', 'revise', 'reject', 'reply', 'waive'] as const;

const FEEDBACK_FIELD: FieldSpec = {
  name: 'feedback',
  kind: 'text',
  positional: 'rest',
  required: true,
  description: 'What should change.',
};

const GATE_FIELD: FieldSpec = {
  name: 'gate',
  kind: 'text',
  positional: 'one',
  required: true,
  description: 'The gate id, from `shinsa tasks show`.',
};

interface GateTarget {
  describe: string;
  type: GateType;
}

const PLAN: GateTarget = { describe: 'plan to approve', type: 'plan' };

const REVIEW: GateTarget = { describe: 'changes to review', type: 'review' };

const MERGE: GateTarget = { describe: 'merge to approve', type: 'merge' };

const OPERATION: GateTarget = { describe: 'operation to confirm', type: 'operation' };

const QUESTION: GateTarget = { describe: 'question from an agent', type: 'question' };

const DONE_TEXT: Record<GateDecision, string> = {
  approve: 'Approved.',
  revise: 'Asked for changes. The agent picks them up.',
  reject: 'Rejected.',
  reply: 'Answered. The agent carries on.',
  waive: 'Starting without checks.',
};

async function answerGate(
  client: SurfaceClient,
  values: Values,
  target: GateTarget,
  decision: GateDecision,
  response: string | null
): Promise<UserCommand> {
  const gate = await findOpenGate(
    client,
    readValue(values, 'task'),
    target.describe,
    (candidate) => candidate.type === target.type
  );
  return {
    type: 'gate.answer',
    gateId: gate.id,
    decision,
    response,
    ...(gate.planVersion === undefined ? {} : { planVersion: gate.planVersion }),
  };
}

function defineGateShortcut(
  path: readonly string[],
  summary: string,
  target: GateTarget,
  decision: 'approve' | 'reject'
): SurfaceSpec {
  return defineCommand({
    path,
    summary,
    command: 'gate.answer',
    humanOnly: true,
    fields: [TASK_FIELD],
    build: (values, client) => answerGate(client, values, target, decision, null),
    done: () => DONE_TEXT[decision],
  });
}

function defineWordsShortcut(
  path: readonly string[],
  summary: string,
  target: GateTarget,
  decision: 'revise' | 'reply'
): SurfaceSpec {
  const field: FieldSpec =
    decision === 'reply'
      ? { ...FEEDBACK_FIELD, name: 'answer', description: 'Your answer.' }
      : FEEDBACK_FIELD;
  return defineCommand({
    path,
    summary,
    command: 'gate.answer',
    humanOnly: true,
    fields: [TASK_FIELD, field],
    build: (values, client) => answerGate(client, values, target, decision, readValue(values, field.name)),
    done: () => DONE_TEXT[decision],
  });
}

function readIndexes(values: Values, name: string) {
  return ((values[name] as string[] | undefined) ?? []).map((raw) => {
    const index = Number(raw);
    if (!Number.isInteger(index) || index < 0) throw new Error(`${raw} is not a finding number.`);
    return index;
  });
}

function buildVerdicts(values: Values): FindingVerdict[] {
  const note = readValue(values, 'note') || null;
  return [
    ...readIndexes(values, 'fix').map((index) => ({ index, verdict: 'fix' as const, note })),
    ...readIndexes(values, 'dismiss').map((index) => ({ index, verdict: 'dismiss' as const, note: null })),
  ];
}

export const GATE_SPECS: SurfaceSpec[] = [
  defineCommand({
    path: ['gates', 'answer'],
    summary: 'Answer any open decision by its gate id.',
    command: 'gate.answer',
    humanOnly: true,
    fields: [
      GATE_FIELD,
      {
        name: 'decision',
        kind: 'choice',
        choices: DECISIONS,
        required: true,
        description: 'approve, revise, reject, reply or waive.',
      },
      { name: 'response', kind: 'text', description: 'Your reply or feedback.' },
      { name: 'planVersion', kind: 'integer', description: 'The plan version you read, for a plan.' },
      {
        name: 'verdicts',
        kind: 'json',
        description: 'Review verdicts: [{"index":0,"verdict":"fix","note":null}].',
      },
    ],
    build: (values) => ({
      type: 'gate.answer',
      gateId: readValue(values, 'gate'),
      decision: values.decision as GateDecision,
      response: readValue(values, 'response') || null,
      ...(values.planVersion === undefined ? {} : { planVersion: values.planVersion as number }),
      ...(values.verdicts === undefined ? {} : { verdicts: values.verdicts as FindingVerdict[] }),
    }),
    done: (values) => DONE_TEXT[values.decision as GateDecision],
  }),
  defineGateShortcut(
    ['plans', 'approve'],
    'Approve the plan of a task, so building starts.',
    PLAN,
    'approve'
  ),
  defineWordsShortcut(['plans', 'revise'], 'Ask the agent to revise the plan.', PLAN, 'revise'),
  defineGateShortcut(['plans', 'reject'], 'Reject the plan and cancel the task.', PLAN, 'reject'),
  defineGateShortcut(
    ['reviews', 'approve'],
    'Approve the changes of a task, so Shinsa opens the pull request.',
    REVIEW,
    'approve'
  ),
  defineWordsShortcut(['reviews', 'revise'], 'Request changes; the agent makes them.', REVIEW, 'revise'),
  defineGateShortcut(['reviews', 'reject'], 'Reject the changes and cancel the task.', REVIEW, 'reject'),
  defineCommand({
    path: ['reviews', 'verdicts'],
    summary:
      'Decide each finding of an escalated review: fix it or dismiss it. Dismissing all of them approves.',
    command: 'gate.answer',
    humanOnly: true,
    fields: [
      TASK_FIELD,
      { name: 'fix', kind: 'list', description: 'Finding numbers to fix (from 0).' },
      { name: 'dismiss', kind: 'list', description: 'Finding numbers to dismiss (from 0).' },
      { name: 'note', kind: 'text', description: 'A note for the agent.' },
    ],
    build: async (values, client) => {
      const verdicts = buildVerdicts(values);
      const fixes = verdicts.some((verdict) => verdict.verdict === 'fix');
      const command = await answerGate(client, values, REVIEW, fixes ? 'revise' : 'approve', null);
      return { ...command, verdicts };
    },
    done: () => 'Saved the verdicts.',
  }),
  defineGateShortcut(['merges', 'approve'], 'Merge the pull request of a task.', MERGE, 'approve'),
  defineGateShortcut(['merges', 'reject'], 'Do not merge; cancel the task.', MERGE, 'reject'),
  defineCommand({
    path: ['operations', 'run'],
    summary: 'Run the operation of a change that merged. Notes replace the ones saved on the operation.',
    command: 'gate.answer',
    humanOnly: true,
    fields: [
      TASK_FIELD,
      { name: 'notes', kind: 'text', positional: 'rest', description: 'Notes for the agent.' },
    ],
    build: (values, client) => {
      const notes = readValue(values, 'notes') || null;
      return answerGate(client, values, OPERATION, notes ? 'reply' : 'approve', notes);
    },
    done: (values) =>
      readValue(values, 'notes') ? 'Running the operation with your notes.' : 'Running the operation.',
  }),
  defineCommand({
    path: ['operations', 'finish'],
    summary: 'Finish a task whose change merged without running its operation.',
    command: 'gate.answer',
    humanOnly: true,
    fields: [TASK_FIELD],
    build: (values, client) => answerGate(client, values, OPERATION, 'reject', null),
    done: () => 'Finished without running the operation.',
  }),
  defineWordsShortcut(['questions', 'answer'], "Answer an agent's question on a task.", QUESTION, 'reply'),
  defineAction({
    path: ['gates', 'secret'],
    summary: 'Give an agent the secret it asked for. It goes to the secret store, never to the chat.',
    humanOnly: true,
    fields: [
      GATE_FIELD,
      { name: 'value', kind: 'text', positional: 'one', required: true, description: 'The secret.' },
    ],
    act: async (client, values) => {
      const data = await client.post(`/api/secrets/${encode(values.gate)}`, {
        value: readValue(values, 'value'),
      });
      return { data, text: 'Saved. The agent gets a reference, never the value.' };
    },
  }),
  defineAction({
    path: ['gates', 'decline-secret'],
    summary: 'Decline to give an agent the secret it asked for.',
    humanOnly: true,
    fields: [GATE_FIELD],
    act: async (client, values) => {
      const data = await client.post(`/api/secrets/${encode(values.gate)}`, { decline: true });
      return { data, text: 'Declined.' };
    },
  }),
];
