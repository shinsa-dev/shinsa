import { describe, expect, test } from 'bun:test';
import {
  COMPOSABLE_STEPS,
  SCHEDULE_LIMITS,
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

const HANDED_OVER =
  'Handed over: the human reads it in the chat as your reply. Stop here and write nothing more: never point at it, repeat or summarise it, and never say your turn is over.';

describe('the shape tools', () => {
  test('report_diagnosis and submit_report hand the work over, with a change for the human to approve', async () => {
    const { sent, call } = createCall();
    expect(await handleShapeTool('report_diagnosis', { diagnosis: 'The cache never expires.' }, call)).toBe(
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

  test('every delivery passes the reply to the human’s message on, and refuses one that breaks its limits', async () => {
    const { sent, call } = createCall();
    const reply = {
      headline: 'Checked Safari too.',
      points: [{ ask: 'And Safari?', outcome: 'answered' as const, note: 'Same result.' }],
    };
    const deliveries = [
      ['answer', 'answer'],
      ['report_diagnosis', 'diagnosis'],
      ['submit_report', 'report'],
      ['report_outcome', 'outcome'],
    ] as const;
    for (const [tool, field] of deliveries) {
      expect(SHAPE_TOOL_SPECS[tool].inputSchema.properties).toHaveProperty('reply');
      await handleShapeTool(tool, { [field]: 'Done.', reply }, call);
    }
    expect(sent.map((command) => command.type === 'agent.deliver' && command.reply)).toEqual(
      deliveries.map(() => ({ ...reply, next: null }))
    );
    await expect(
      handleShapeTool('answer', { answer: 'Done.', reply: { headline: '', points: [] } }, call)
    ).rejects.toThrow('reply.points');
  });

  test('report_read ends a read of a data source, with live for a watchdog, and refuses a summary over its limit', async () => {
    const { sent, call } = createCall();
    expect(await handleShapeTool('report_read', { summary: 'Read 12 messages; filed 2.' }, call)).toBe(
      HANDED_OVER
    );
    expect(sent).toEqual([
      {
        type: 'agent.report_read',
        runId: 'run-1',
        attemptId: 'a-1',
        summary: 'Read 12 messages; filed 2.',
        reached: true,
        live: null,
      },
    ] as ShinsaCommand[]);
    expect(SHAPE_TOOL_SPECS.report_read.description).toContain('then stop');
    await handleShapeTool('report_read', { summary: 'slack timed out.', reached: false }, call);
    expect(sent.at(-1)).toMatchObject({ type: 'agent.report_read', reached: false });
    await handleShapeTool('report_read', { summary: 'Not live yet.', live: false }, call);
    expect(sent.at(-1)).toMatchObject({ type: 'agent.report_read', reached: true, live: false });
    await expect(
      handleShapeTool('report_read', { summary: 'Read it.', reached: 'no' }, call)
    ).rejects.toThrow('reached');
    await expect(
      handleShapeTool('report_read', { summary: 'x'.repeat(SCHEDULE_LIMITS.readSummary + 1) }, call)
    ).rejects.toThrow('summary');
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

  test('answer hands the answer over like every inquiry, may propose a change, and reshape_task turns the task into an inquiry', async () => {
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
      { type: 'agent.deliver', runId: 'run-1', attemptId: 'a-1', step: 'answer', body: 'In a.txt.' },
      {
        type: 'agent.deliver',
        runId: 'run-1',
        attemptId: 'a-1',
        step: 'answer',
        body: 'In a.txt.',
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
    expect(steps.items.enum).toEqual([...COMPOSABLE_STEPS]);
    expect(steps.items.enum).not.toContain('post_merge');
    for (const step of COMPOSABLE_STEPS) {
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
    expect(handleShapeTool('report_diagnosis', {}, call)).rejects.toThrow('diagnosis is required.');
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
    expect(SHAPE_TOOL_SPECS.report_diagnosis.inputSchema.properties.diagnosis.maxLength).toBe(
      SHAPE_LIMITS.diagnosis
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

  test('the hand-overs the human reads are the reply itself, in the agent’s own voice, with nothing after them', () => {
    const specs = [
      SHAPE_TOOL_SPECS.answer,
      SHAPE_TOOL_SPECS.report_diagnosis,
      SHAPE_TOOL_SPECS.submit_report,
      SHAPE_TOOL_SPECS.report_outcome,
    ];
    for (const spec of specs) {
      expect(spec.description).toContain('Write it to the human in the first person: it is your reply');
      expect(spec.description).toContain('After the call, stop and write nothing more.');
      expect(spec.description).not.toContain('Shinsa');
      expect(spec.description).not.toMatch(/\b(restate|summari[sz]e)\b/);
    }
  });
});
