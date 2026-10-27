import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { ShinsaState, Task } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, render } from '@testing-library/react';
import { ReferenceAnchor, ReferenceText } from '@/components/links/reference.tsx';
import { replaceRoute } from '@/router.ts';
import { createPullRequest } from '../../support/pull-request.ts';
import { pushState, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createProject, createRepo, createShinsaState, createTask } from '../../support/state.ts';

function createWorld(extra: Task[] = []) {
  return createShinsaState({
    tasks: [
      createTask({ id: 'task-1', title: 'Fix the flaky checkout test' }),
      createTask({
        id: 'task-2',
        title: 'Build the login form',
        pullRequest: createPullRequest({ number: 42 }),
      }),
      ...extra,
    ],
  });
}

function renderText(state: ShinsaState, text: string) {
  pushState(state);
  return render(
    <TooltipProvider>
      <p>
        <ReferenceText text={text} state={state} />
      </p>
    </TooltipProvider>
  );
}

function renderAnchor(state: ShinsaState, href: string, label: string) {
  pushState(state);
  return render(
    <TooltipProvider>
      <p>
        <ReferenceAnchor href={href}>{label}</ReferenceAnchor>
      </p>
    </TooltipProvider>
  );
}

function openTaskPage(taskId: string) {
  act(() => {
    replaceRoute(`/tasks/${taskId}`);
  });
}

beforeEach(() => {
  startFakeServer();
});

afterEach(() => {
  stopFakeServer();
});

describe('ReferenceText', () => {
  it('links a shinsa task reference to the task under its title', () => {
    const view = renderText(createWorld(), 'Next: shinsa://task/task-2 then ship.');
    const link = view.getByRole('link');
    expect(link.textContent).toBe('Build the login form');
    expect(link.getAttribute('href')).toStartWith('/tasks/task-2');
    expect(view.container.textContent).toBe('Next: Build the login form then ship.');
  });

  it('leads a repository link with its project’s dot, grey when it has no project', () => {
    const state = createShinsaState({
      projects: [createProject({ id: 'p', name: 'Superwall', color: 'purple' })],
      repos: [
        createRepo({ id: 'web', name: 'paywall-next', projectId: 'p' }),
        createRepo({ id: 'scratch', name: 'scratch' }),
      ],
    });
    const view = renderText(state, 'See shinsa://repo/paywall-next and shinsa://repo/scratch.');
    const dots = [...view.container.querySelectorAll('[data-project-dot]')];
    expect(dots.map((dot) => dot.getAttribute('data-project-dot'))).toEqual(['purple', 'gray']);
    expect(view.container.querySelector('svg')).toBeNull();
    expect(view.container.textContent).toBe('See paywall-next and scratch.');
  });

  it('keeps an unknown task reference as plain text', () => {
    const view = renderText(createWorld(), 'See shinsa://task/gone for details.');
    expect(view.queryByRole('link')).toBeNull();
    expect(view.container.textContent).toBe('See shinsa://task/gone for details.');
  });

  it('keeps a malformed reference as plain text', () => {
    const view = renderText(createWorld(), 'See shinsa://pr/not-a-number here.');
    expect(view.queryByRole('link')).toBeNull();
    expect(view.container.textContent).toBe('See shinsa://pr/not-a-number here.');
  });

  it('links a bare pull request number that only one task has', () => {
    const view = renderText(createWorld(), 'Merged in #42.');
    const link = view.getByRole('link');
    expect(link.getAttribute('href')).toBe('https://github.com/you/app/pull/42');
    expect(link.textContent).toBe('#42');
  });

  it('leaves a bare pull request number alone when two tasks share it', () => {
    const twin = createTask({
      id: 'task-3',
      title: 'Another change',
      pullRequest: createPullRequest({ number: 42 }),
    });
    const view = renderText(createWorld([twin]), 'Merged in #42.');
    expect(view.queryByRole('link')).toBeNull();
    expect(view.container.textContent).toBe('Merged in #42.');
  });

  it('leaves a number no pull request has alone', () => {
    const view = renderText(createWorld(), 'Step #7 is next.');
    expect(view.queryByRole('link')).toBeNull();
  });

  it('links a quoted task title', () => {
    const view = renderText(createWorld(), 'Wait for “Build the login form” first.');
    expect(view.getByRole('link').textContent).toBe('Build the login form');
  });

  it('does not link the open task’s own title on its handle URL', () => {
    const state = createShinsaState({
      tasks: [
        createTask({ id: 'task-1', handle: 'SW-1', title: 'Fix the flaky checkout test' }),
        createTask({ id: 'task-2', handle: 'SW-2', title: 'Build the login form' }),
      ],
    });
    openTaskPage('SW-1');
    const view = renderText(state, 'Fix the flaky checkout test, then Build the login form.');
    expect(view.getAllByRole('link').map((link) => link.textContent)).toEqual(['Build the login form']);
  });
});

describe('ReferenceAnchor', () => {
  it('replaces the link label with the task it points at', () => {
    const view = renderAnchor(createWorld(), 'shinsa://task/task-1', 'that test');
    expect(view.getByRole('link').textContent).toBe('Fix the flaky checkout test');
  });

  it('shows its label without a link when the task is unknown', () => {
    const view = renderAnchor(createWorld(), 'shinsa://task/gone', 'the old task');
    expect(view.queryByRole('link')).toBeNull();
    expect(view.container.textContent).toBe('the old task');
  });

  it('shows its label without a link when the reference does not parse', () => {
    const view = renderAnchor(createWorld(), 'shinsa://nothing/here', 'somewhere');
    expect(view.queryByRole('link')).toBeNull();
    expect(view.container.textContent).toBe('somewhere');
  });

  it('describes an unresolved reference that has no label', () => {
    const view = renderAnchor(createWorld(), 'shinsa://pr/app#9', '');
    expect(view.queryByRole('link')).toBeNull();
    expect(view.container.textContent).toBe('#9');
  });

  it('resolves a pull request number shared by two tasks to the current task', () => {
    const twin = createTask({
      id: 'task-3',
      title: 'Another change',
      pullRequest: createPullRequest({ number: 42 }),
    });
    openTaskPage('task-3');
    const view = renderAnchor(createWorld([twin]), 'shinsa://pr/42', '#42');
    expect(view.getByRole('link').getAttribute('href')).toBe('https://github.com/you/app/pull/42');
  });
});
