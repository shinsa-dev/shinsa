import { describe, expect, it } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { render, screen, waitFor } from '@testing-library/react';
import { AutomationPage } from '@/routes/automation.tsx';
import { TaskPage } from '@/routes/task/index.tsx';
import { createSchedule } from '../support/schedules.ts';
import {
  createGate,
  createProject,
  createRun,
  createShinsaState,
  createTask,
  NOW,
} from '../support/state.ts';

const watch = createSchedule({
  id: 'w',
  name: 'Feedback',
  source: { projectId: 'p1', server: 'slack' },
  target: { kind: 'task', taskId: 'home' },
});

const state = createShinsaState({
  projects: [
    createProject({
      id: 'p1',
      watchSources: [
        { server: 'slack', data: 'The #feedback channel', repoIds: [], addedBy: 'you', addedAt: 0 },
      ],
    }),
  ],
  tasks: [
    createTask({ id: 'home', title: 'Watches slack', watchHome: true }),
    createTask({
      id: 'filed',
      title: 'Editor loses edits',
      sourceReport: {
        scheduleId: 'w',
        server: 'slack',
        reportId: '1',
        link: null,
        author: null,
        postedAt: null,
        text: 'Broken.',
      },
      createdBy: { kind: 'intake', taskId: 'home', runId: 'read', requestKey: '1' },
    }),
  ],
  runs: [
    createRun({
      id: 'read',
      taskId: 'home',
      purpose: 'intake',
      startedAt: NOW - 60_000,
      endedAt: NOW,
      outcome: 'completed',
      summary: 'Read 4 messages; filed 1.',
    }),
  ],
  patch: { schedules: { w: watch } },
});

describe('an automation’s page', () => {
  it('shows what a watch reads, the tasks it filed and each read', () => {
    const { container } = render(
      <TooltipProvider>
        <AutomationPage state={state} scheduleId='w' />
      </TooltipProvider>
    );
    expect(screen.getByRole('heading', { name: 'Feedback' })).toBeDefined();
    expect(screen.getByText('Watch')).toBeDefined();
    expect(screen.getByText('Every hour')).toBeDefined();
    expect(screen.getByText('Tasks it filed')).toBeDefined();
    expect(screen.getByText('Pull request')).toBeDefined();
    expect(container.querySelectorAll('[data-task="filed"]')).toHaveLength(1);
    expect(screen.getByText('Editor loses edits')).toBeDefined();
    expect(screen.getByText('Read 4 messages; filed 1.')).toBeDefined();
    expect(screen.queryByText('Watches slack')).toBeNull();
  });

  it('says when the automation is gone, and that a new watch has filed and read nothing yet', () => {
    const { unmount } = render(<AutomationPage state={state} scheduleId='gone' />);
    expect(screen.getByText('No such automation')).toBeDefined();
    unmount();
    const bare = createShinsaState({ patch: { schedules: { w: watch } } });
    render(
      <TooltipProvider>
        <AutomationPage state={bare} scheduleId='w' />
      </TooltipProvider>
    );
    expect(screen.getByText('Nothing filed yet.')).toBeDefined();
    expect(screen.getByText('No read yet. The first one starts at its next run.')).toBeDefined();
  });

  it('shows a question the watch asked, to answer on its page', () => {
    const asking = createShinsaState({
      tasks: [createTask({ id: 'home', title: 'Watches slack', watchHome: true })],
      gates: [
        createGate({ id: 'q', taskId: 'home', type: 'question', title: 'Which channel is #feedback?' }),
      ],
      patch: { schedules: { w: watch } },
    });
    render(
      <TooltipProvider>
        <AutomationPage state={asking} scheduleId='w' />
      </TooltipProvider>
    );
    expect(screen.getByText('Which channel is #feedback?')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Send answer' })).toBeDefined();
  });

  it('shows a watch paused at its cost limit, with the way to go on or stop it', () => {
    const paused = createShinsaState({
      tasks: [createTask({ id: 'home', title: 'Watches slack', watchHome: true })],
      gates: [
        createGate({
          id: 'b',
          taskId: 'home',
          type: 'failure',
          cause: 'budget',
          title: 'Reached its cost limit',
          body: 'This task reached its $1.00 cost limit.',
        }),
      ],
      patch: { schedules: { w: watch } },
    });
    render(
      <TooltipProvider>
        <AutomationPage state={paused} scheduleId='w' />
      </TooltipProvider>
    );
    expect(screen.getByText('Reached its cost limit')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined();
    expect(screen.getByText('Stop this watch')).toBeDefined();
  });

  it('sends a watch’s home task to the watch’s page', async () => {
    history.replaceState(null, '', '/tasks/home');
    const { container } = render(
      <TooltipProvider>
        <TaskPage state={state} taskId='home' />
      </TooltipProvider>
    );
    expect(container.textContent).toBe('');
    await waitFor(() => expect(location.pathname).toBe('/automations/w'));
  });
});
