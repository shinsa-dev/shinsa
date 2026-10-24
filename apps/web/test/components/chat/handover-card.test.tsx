import { describe, expect, it } from 'bun:test';
import type { ChatTool } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { render } from '@testing-library/react';
import { HandoverCard } from '@/components/chat/handover-card.tsx';
import type { ToolCall } from '@/lib/chat/timeline.ts';
import { describeTool } from '@/lib/chat/tool-describe.ts';
import { createRun } from '../../support/state.ts';

function call(
  name: Extract<ChatTool, { kind: 'shinsa' }>['name'],
  args: Record<string, unknown>,
  result: string | null = null
): ToolCall {
  const tool: ChatTool = { kind: 'shinsa', name, args };
  return {
    key: name,
    callId: name,
    tool,
    description: describeTool(tool),
    result,
    images: [],
    failed: false,
    recovery: null,
  };
}

function renderCard(toolCall: ToolCall) {
  return render(
    <TooltipProvider>
      <HandoverCard call={toolCall} run={createRun({ id: 'r', taskId: 't' })} live={false} />
    </TooltipProvider>
  );
}

describe('HandoverCard for the process tools', () => {
  it('shows a revised plan with what changed', () => {
    const view = renderCard(
      call('propose_plan', {
        goal: 'Ship it.',
        phases: [{ title: 'One', detail: 'First.' }],
        change_summary: 'Split the work in two.',
      })
    );
    expect(view.getByText('Revised the plan')).toBeTruthy();
    expect(view.getByText('What changed')).toBeTruthy();
    expect(view.getByText('Split the work in two.')).toBeTruthy();
  });

  it('shows the plan’s evidence, extra checks, impact and that it asked for your approval', () => {
    const view = renderCard(
      call('propose_plan', {
        goal: 'Backfill currencies.',
        phases: [{ title: 'Add the script', detail: 'With a dry run.' }],
        impact: 'About 400 rows.',
        evidence: ['test', 'preview'],
        checks: ['bun test currency'],
        approval: true,
      })
    );
    expect(view.getByText('Proposed the plan')).toBeTruthy();
    expect(view.getByText('About 400 rows.')).toBeTruthy();
    expect(view.getByText('Test output · Preview link')).toBeTruthy();
    expect(view.getByText('Extra checks')).toBeTruthy();
    expect(view.getByText('bun test currency')).toBeTruthy();
    expect(view.getByText('The agent asked for your approval.')).toBeTruthy();
  });

  it('shows the steps the agent composed with its reason, and a plain change of kind without them', () => {
    const composed = renderCard(
      call('reshape_task', { steps: ['research', 'your_ok', 'plan', 'operate'], reason: 'Compare first.' })
    );
    expect(composed.getByText('Set the steps')).toBeTruthy();
    expect(composed.getByText('Compare first.')).toBeTruthy();
    expect(composed.getByText('Research, your OK, plan, run the operation')).toBeTruthy();
    composed.unmount();
    const plain = renderCard(call('reshape_task', { shape: 'answer', reason: 'Only a question.' }));
    expect(plain.getByText('Changed the kind of task')).toBeTruthy();
    expect(plain.queryByText('Steps')).toBeNull();
  });

  it('shows a question’s choices and marks a withdrawn one', () => {
    const view = renderCard(
      call(
        'ask',
        { question: 'Which colour?', choices: ['Blue', 'Green'] },
        'The question was withdrawn. Continue with your best judgement.'
      )
    );
    expect(view.getByText('Blue')).toBeTruthy();
    expect(view.getByText('Withdrawn')).toBeTruthy();
    expect(view.queryByText('Your answer')).toBeNull();
  });

  it('shows a delegated agent’s question as asked of the agent that delegated it, with its answer', () => {
    const run = createRun({
      id: 'r',
      taskId: 't',
      delegation: {
        parentRunId: 'step',
        depth: 1,
        requestKey: 'k',
        title: 'Check it',
        brief: 'Check it.',
        mode: 'async',
        wake: 'always',
        isolation: 'shared',
        baseCommit: null,
        delivery: 'none',
        question: null,
        requestedAt: 0,
      },
    });
    const view = render(
      <TooltipProvider>
        <HandoverCard call={call('ask', { question: 'Which file?' }, 'Use a.ts')} run={run} live={false} />
      </TooltipProvider>
    );
    expect(view.getByText('Asked the agent that delegated it')).toBeTruthy();
    expect(view.getByText('Its answer')).toBeTruthy();
    expect(view.queryByText('Asked you')).toBeNull();
  });

  it('lists suggested tasks, shows an answer, and keeps a scheduled check-in as a row', () => {
    const suggested = renderCard(
      call('suggest_tasks', {
        tasks: [
          { title: 'Cache it', why: 'It is slow.' },
          { title: 'Chart it', why: 'Trends.' },
        ],
      })
    );
    expect(suggested.getByText('Suggested 2 tasks')).toBeTruthy();
    expect(suggested.getByText('It is slow.')).toBeTruthy();
    suggested.unmount();
    const answered = renderCard(call('answer', { answer: 'It retries **three** times.' }));
    expect(answered.getByText('Handed over the answer')).toBeTruthy();
    expect(answered.getByText('three')).toBeTruthy();
    answered.unmount();
    const waited = renderCard(call('wait_for', { notes: 'The deploy.' }, 'Shinsa will wake a fresh agent.'));
    expect(waited.getByText(/Scheduled a check-in/)).toBeTruthy();
  });

  it('lists the judgement calls a phase handed over, and shows an investigation’s diagnosis', () => {
    const phase = renderCard(
      call('complete_phase', {
        summary: 'The form validates input.',
        judgement_calls: [{ call: 'Kept the old reader', reason: 'Other callers still use it.' }],
      })
    );
    expect(phase.getByText('Judgement calls')).toBeTruthy();
    expect(phase.getByText('Kept the old reader')).toBeTruthy();
    expect(phase.getByText('Other callers still use it.')).toBeTruthy();
    phase.unmount();
    const diagnosed = renderCard(call('report_diagnosis', { diagnosis: 'The pool runs **dry**.' }));
    expect(diagnosed.getByText('Reported the diagnosis')).toBeTruthy();
    expect(diagnosed.getByText('dry')).toBeTruthy();
  });
});
