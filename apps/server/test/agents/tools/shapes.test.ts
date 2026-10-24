import { describe, expect, test } from 'bun:test';
import {
  PIPELINE_ORDER,
  SHAPE_LIMITS,
  type ShinsaCommand,
  type ShinsaEvent,
  STEP_SCHEMA,
} from '@shinsa/core';
import { handleShapeTool, SHAPE_TOOL_SPECS } from '../../../src/agents/tools/shapes.ts';

const RESHAPED = {
  type: 'task.reshaped',
  taskId: 't-1',
  pipeline: ['research'],
  by: 'agent',
  reason: 'x',
  seq: 1,
  at: 1,
} as ShinsaEvent;

function createCall(events: ShinsaEvent[] = []) {
  const sent: ShinsaCommand[] = [];
  return {
    sent,
    call: {
      runId: 'run-1',
      attemptId: 'a-1',
      dispatch: (command: ShinsaCommand) => {
        sent.push(command);
        return Promise.resolve(events);
      },
    },
  };
}

const HANDED_OVER = 'Handed over to Shinsa. End your turn now.';

describe('the shape tools', () => {
  test('report_diagnosis and submit_report hand the work over, with a change for the human to approve', async () => {
    const { sent, call } = createCall();
    expect(await handleShapeTool('report_diagnosis', { findings: 'The cache never expires.' }, call)).toBe(
      HANDED_OVER
    );
    expect(
      await handleShapeTool(
        'submit_report',
        {
          report: 'Option B is faster.',
          propose_change: { request: 'Switch to option B.', why: 'It halves the build time.' },
        },
        call
      )
    ).toBe(HANDED_OVER);
    expect(sent).toEqual([
      {
        type: 'agent.deliver',
        runId: 'run-1',
        attemptId: 'a-1',
        step: 'investigate',
        body: 'The cache never expires.',
      },
      {
        type: 'agent.deliver',
        runId: 'run-1',
        attemptId: 'a-1',
        step: 'research',
        body: 'Option B is faster.',
        proposal: { request: 'Switch to option B.', why: 'It halves the build time.' },
      },
    ] as ShinsaCommand[]);
  });

  test('report_outcome hands the operation over, and never carries a proposal', async () => {
    const { sent, call } = createCall();
    await handleShapeTool(
      'report_outcome',
      { outcome: 'Ran the migration.', propose_change: { request: 'More.', why: 'Because.' } },
      call
    );
    expect(sent).toEqual([
      {
        type: 'agent.deliver',
        runId: 'run-1',
        attemptId: 'a-1',
        step: 'operate',
        body: 'Ran the migration.',
      },
    ] as ShinsaCommand[]);
  });

  test('answer may propose a change, and reshape_task turns the task into an inquiry', async () => {
    const { sent, call } = createCall([RESHAPED]);
    await handleShapeTool('answer', { answer: 'In a.txt.' }, call);
    await handleShapeTool(
      'answer',
      { answer: 'In a.txt.', propose_change: { request: 'Move it.', why: 'It is easier to find.' } },
      call
    );
    expect(
      await handleShapeTool('reshape_task', { shape: 'research', reason: 'It asks for a comparison.' }, call)
    ).toBe(HANDED_OVER);
    expect(sent).toEqual([
      { type: 'agent.answer', runId: 'run-1', attemptId: 'a-1', answer: 'In a.txt.' },
      {
        type: 'agent.answer',
        runId: 'run-1',
        attemptId: 'a-1',
        answer: 'In a.txt.',
        proposal: { request: 'Move it.', why: 'It is easier to find.' },
      },
      {
        type: 'agent.reshape',
        runId: 'run-1',
        attemptId: 'a-1',
        shape: 'research',
        reason: 'It asks for a comparison.',
      },
    ] as ShinsaCommand[]);
  });

  test('reshape_task composes steps, and steps the task already has leave the planner planning', async () => {
    const steps = ['investigate', 'your_ok', 'plan', 'operate'];
    const composed = createCall([RESHAPED]);
    expect(
      await handleShapeTool('reshape_task', { steps, reason: 'Find it, then clear it.' }, composed.call)
    ).toBe(HANDED_OVER);
    expect(composed.sent).toEqual([
      { type: 'agent.reshape', runId: 'run-1', attemptId: 'a-1', steps, reason: 'Find it, then clear it.' },
    ] as ShinsaCommand[]);
    const unchanged = createCall();
    expect(
      await handleShapeTool('reshape_task', { steps: ['plan', 'operate'], reason: 'x' }, unchanged.call)
    ).toBe('Those are the steps this task already has. Plan it with `propose_plan`.');
    expect(
      handleShapeTool('reshape_task', { steps: ['plan', 'deploy'], reason: 'x' }, unchanged.call)
    ).rejects.toThrow('steps[1] must be one of answer, research, investigate, your_ok, plan, operate, build');
    expect(SHAPE_TOOL_SPECS.reshape_task.inputSchema.properties.steps.items.enum).toContain('your_ok');
  });

  test('reshape_task offers exactly the building blocks, each with its title and what ends it, and no others', () => {
    const steps = SHAPE_TOOL_SPECS.reshape_task.inputSchema.properties.steps;
    expect(steps.items.enum).toEqual([...PIPELINE_ORDER]);
    for (const step of PIPELINE_ORDER) {
      expect(steps.description).toContain(
        `- \`${step}\` (${STEP_SCHEMA[step].title}): ${STEP_SCHEMA[step].exit}`
      );
    }
    expect(steps.description).toContain('You cannot add steps or gates');
    expect(SHAPE_TOOL_SPECS.reshape_task.inputSchema.properties.shape.enum).toEqual([
      'answer',
      'investigate',
      'research',
    ]);
  });

  test('a hand-over that breaks the protocol is rejected with the reasons, and other tools are not this module’s', async () => {
    const { sent, call } = createCall();
    expect(handleShapeTool('report_diagnosis', {}, call)).rejects.toThrow('findings is required.');
    expect(
      handleShapeTool('submit_report', { report: 'x'.repeat(SHAPE_LIMITS.report + 1) }, call)
    ).rejects.toThrow(`the limit is ${SHAPE_LIMITS.report}`);
    expect(
      handleShapeTool('answer', { answer: 'Yes.', propose_change: { request: 'Do it.' } }, call)
    ).rejects.toThrow('propose_change.why is required.');
    expect(handleShapeTool('reshape_task', { shape: 'change', reason: 'x' }, call)).rejects.toThrow(
      'shape must be one of answer, investigate, research.'
    );
    expect(await handleShapeTool('constructor', {}, call)).toBeNull();
    expect(sent).toEqual([]);
  });

  test('the schemas publish the limits and say the human decides on a proposed change', () => {
    expect(SHAPE_TOOL_SPECS.report_diagnosis.inputSchema.properties.findings.maxLength).toBe(
      SHAPE_LIMITS.findings
    );
    expect(SHAPE_TOOL_SPECS.submit_report.inputSchema.properties.report.maxLength).toBe(SHAPE_LIMITS.report);
    expect(SHAPE_TOOL_SPECS.report_outcome.inputSchema.properties.outcome.maxLength).toBe(
      SHAPE_LIMITS.outcome
    );
    expect(SHAPE_TOOL_SPECS.reshape_task.inputSchema.properties.reason.maxLength).toBe(SHAPE_LIMITS.reason);
    const proposal = SHAPE_TOOL_SPECS.answer.inputSchema.properties.propose_change;
    expect(proposal.properties.request.maxLength).toBe(SHAPE_LIMITS.request);
    expect(proposal.properties.why.maxLength).toBe(SHAPE_LIMITS.why);
    expect(proposal.description).toContain('The human decides');
    expect(SHAPE_TOOL_SPECS.report_outcome.inputSchema.properties).not.toHaveProperty('propose_change');
  });
});
