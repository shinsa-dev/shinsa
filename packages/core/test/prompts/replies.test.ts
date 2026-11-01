import { describe, expect, test } from 'bun:test';
import type { Iteration, ReplyingHandOver, Task } from '../../src/index.ts';
import {
  describeReplyInstruction,
  resolveAnswererPrompt,
  resolveFollowUpPrompt,
  resolveHumanFixPrompt,
  resolveInvestigatorPrompt,
  resolveOperationInstruction,
  resolvePlanningPrompt,
  resolveResearcherPrompt,
} from '../../src/prompts/index.ts';
import { createHarness, createTask, proposePlan } from '../harness.ts';

const OPEN: Iteration = {
  id: 'i1',
  round: 1,
  requests: [{ text: 'Add a test phase.', comments: 0, at: 1 }],
  reply: null,
  runId: null,
  repliedAt: null,
};

const ANSWERED: Iteration = {
  ...OPEN,
  reply: {
    headline: 'Added it.',
    points: [{ ask: 'Add a test', outcome: 'done', note: 'Phase 3.' }],
    next: null,
  },
  repliedAt: 2,
};

function planned() {
  const harness = createHarness();
  const taskId = createTask(harness, { request: 'Fix the scroll in tab groups' });
  proposePlan(harness, taskId);
  return harness.task(taskId);
}

const PROMPTS: [ReplyingHandOver, (task: Task) => string][] = [
  ['propose_plan', (task) => resolvePlanningPrompt(task, null, [], 'Add a test phase.')],
  ['submit_report', (task) => resolveResearcherPrompt(task, null, 'And Safari?')],
  ['report_diagnosis', (task) => resolveInvestigatorPrompt(task, null, 'And on Linux?')],
  ['answer', (task) => resolveAnswererPrompt(task, null, 'Why?')],
  ['answer', (task) => resolveFollowUpPrompt(task, null, 'Why?')],
  ['report_outcome', (task) => resolveOperationInstruction(task, 'Run it on staging first.')],
];

describe('the reply an agent owes the human', () => {
  test('names the hand-over that carries it and the fields it takes', () => {
    const instruction = describeReplyInstruction('submit_report');
    expect(instruction).toContain('so `submit_report` also takes `reply`');
    for (const field of ['`headline`', '`points`', '`next`']) expect(instruction).toContain(field);
  });

  test('every prompt asks for it while a message waits for an answer, naming its own hand-over', () => {
    const task = { ...planned(), iterations: [OPEN] };
    for (const [tool, prompt] of PROMPTS) expect(prompt(task)).toContain(describeReplyInstruction(tool));
  });

  test('no prompt asks for it once the message is answered or when none was sent', () => {
    for (const iterations of [[], [ANSWERED]]) {
      const task = { ...planned(), iterations };
      for (const [, prompt] of PROMPTS) expect(prompt(task)).not.toContain('also takes `reply`');
    }
  });

  test('a revised plan no longer asks for a change summary', () => {
    const task = { ...planned(), iterations: [OPEN] };
    expect(resolvePlanningPrompt(task, null, [], 'Add a test phase.')).not.toContain('change_summary');
  });

  test('a fix the human asked for always owes one', () => {
    expect(resolveHumanFixPrompt('Rename it.', [])).toContain(describeReplyInstruction('complete_fix'));
  });
});
