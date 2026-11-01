import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { type ChatTool, resolveAnsweredReply, serializeAttachments, type Task } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render } from '@testing-library/react';
import { HandoverCard } from '@/components/chat/handover-card.tsx';
import type { ToolCall } from '@/lib/chat/timeline.ts';
import { describeTool } from '@/lib/chat/tool-describe.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { createWatchSuggestion } from '../../support/schedules.ts';
import { pushState, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createRun, createShinsaState, createTask } from '../../support/state.ts';

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

function renderCard(toolCall: ToolCall, task: Task | null = null) {
  return render(
    <TooltipProvider>
      <HandoverCard call={toolCall} run={createRun({ id: 'r', taskId: 't' })} live={false} task={task} />
    </TooltipProvider>
  );
}

describe('HandoverCard for the process tools', () => {
  it('shows a plan it finds no revision of as proposed, with its goal', () => {
    const view = renderCard(
      call('propose_plan', {
        goal: 'Ship it.',
        phases: [{ title: 'One', detail: 'First.' }],
      })
    );
    expect(view.getByText('Proposed the plan')).toBeTruthy();
    expect(view.getByText('Ship it.')).toBeTruthy();
    expect(view.queryByText('What changed')).toBeNull();
    expect(view.queryByText('New')).toBeNull();
  });

  it('marks the phases a revision added or reworked, from the task’s plan versions', () => {
    const document = {
      goal: 'Ship it.',
      phases: [],
      behaviour: [],
      approach: '',
      files: [],
      outOfScope: [],
      verification: [],
      questions: [],
    };
    const task = createTask({
      id: 't',
      plan: {
        version: 2,
        body: '',
        document,
        proposedAt: 1,
        changes: [
          { kind: 'phase_added', title: 'Two' },
          { kind: 'phase_changed', title: 'One' },
          { kind: 'phase_removed', title: 'Zero' },
        ],
      },
    });
    const view = renderCard(
      call('propose_plan', {
        goal: 'Ship it.',
        phases: [{ title: 'One', detail: 'First.' }, { title: 'Two', detail: 'Second.' }, { title: 'Three' }],
      }),
      task
    );
    expect(view.getByText('Revised the plan')).toBeTruthy();
    expect(view.getByText('One').parentElement?.textContent).toBe('OneChanged');
    expect(view.getByText('Two').parentElement?.textContent).toBe('TwoNew');
    expect(view.getByText('Three').parentElement?.textContent).toBe('Three');
    expect(view.queryByText('Zero')).toBeNull();
  });

  it('shows the plan’s evidence, checks, impact and that it asked for your approval', () => {
    const view = renderCard(
      call('propose_plan', {
        goal: 'Backfill currencies.',
        phases: [{ title: 'Add the script', detail: 'With a dry run.' }],
        impact: 'About 400 rows.',
        evidence: ['test', 'preview'],
        verification: [{ label: 'Currency tests', command: 'bun test currency', phases: [1] }],
        approval: true,
      })
    );
    expect(view.getByText('Proposed the plan')).toBeTruthy();
    expect(view.getByText('About 400 rows.')).toBeTruthy();
    expect(view.getByText('Linked test · Preview link')).toBeTruthy();
    expect(view.getByText('Checks')).toBeTruthy();
    expect(view.getByText('Currency tests')).toBeTruthy();
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

  it('shows the files attached to your answer as chips, never the markup they travel in', () => {
    const answer = serializeAttachments('Like this', [
      {
        kind: 'file',
        name: 'trace.log',
        url: '/api/attachments/1/trace.log',
        path: '/d/trace.log',
        mimeType: 'text/plain',
        size: 2048,
      },
    ]);
    const view = renderCard(call('ask', { question: 'Which run?' }, resolveAnsweredReply(answer, false)));
    expect(view.getByText('Your answer')).toBeTruthy();
    expect(view.getByText('Like this')).toBeTruthy();
    expect(view.getByText('trace.log')).toBeTruthy();
    expect(view.container.textContent).not.toContain('<attachment');
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
        judgement_calls: [
          {
            title: 'Keep the old reader',
            call: 'Kept the old reader',
            reason: 'Other callers still use it.',
          },
        ],
      })
    );
    expect(phase.getByText('Judgement calls')).toBeTruthy();
    expect(phase.getByText('Keep the old reader')).toBeTruthy();
    expect(phase.getByText('Kept the old reader')).toBeTruthy();
    expect(phase.getByText('Other callers still use it.')).toBeTruthy();
    phase.unmount();
    const diagnosed = renderCard(call('report_diagnosis', { diagnosis: 'The pool runs **dry**.' }));
    expect(diagnosed.getByText('Reported the diagnosis')).toBeTruthy();
    expect(diagnosed.getByText('dry')).toBeTruthy();
  });
});

describe('HandoverCard for a watch an agent suggests', () => {
  const args = {
    name: 'Bugs in #feedback',
    message: 'File a task for each new bug in #feedback.',
    source: 'slack',
  };
  const task = createTask({ id: 't' });
  let spies: ReturnType<typeof spyOnCommands>;

  beforeEach(() => {
    startFakeServer();
    spies = spyOnCommands();
  });

  afterEach(() => {
    spies.restore();
    stopFakeServer();
  });

  function pushSuggestion(overrides: Parameters<typeof createWatchSuggestion>[0]) {
    const suggestion = createWatchSuggestion({
      origin: { kind: 'agent', taskId: 't', runId: 'r' },
      ...overrides,
    });
    pushState(
      createShinsaState({ tasks: [task], patch: { watchSuggestions: { [suggestion.id]: suggestion } } })
    );
  }

  it('waits for you with Add the watch and Cancel, which send the commands', async () => {
    pushSuggestion({ id: 's1' });
    const view = renderCard(call('set_schedule', args), task);
    expect(view.getByText('Suggested a watch')).toBeTruthy();
    expect(view.getByText('Waits for you')).toBeTruthy();
    expect(view.getByText('slack · every hour')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Add the watch' }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(view.queryByRole('button', { name: 'Dismiss the suggested watch' })).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
    expect(spies.sent.mock.calls.map(([command]) => command)).toEqual([
      { type: 'watch_suggestion.accept', suggestionId: 's1' },
      { type: 'watch_suggestion.dismiss', suggestionId: 's1' },
    ]);
  });

  it('once added, links to the watch and offers no buttons', () => {
    pushSuggestion({ id: 's1', status: 'accepted', scheduleId: 'w1' });
    const view = renderCard(call('set_schedule', args), task);
    expect(view.getByText('Added')).toBeTruthy();
    expect(view.getByRole('link', { name: 'Open the watch' }).getAttribute('href')).toBe('/automations/w1');
    expect(view.queryByRole('button', { name: 'Add the watch' })).toBeNull();
  });

  it('says so when the suggestion is gone, naming the integration from the call', () => {
    pushState(createShinsaState({ tasks: [task] }));
    const view = renderCard(call('set_schedule', args), task);
    expect(view.getByText('No longer open')).toBeTruthy();
    expect(view.getByText('slack')).toBeTruthy();
  });
});
