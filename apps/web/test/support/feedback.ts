import { mock } from 'bun:test';
import type { Feedback } from '@shinsa/core';
import type { FeedbackActions } from '@/lib/feedback.ts';
import { createProject, createShinsaState, createTask } from './state.ts';

export function createFeedback(overrides: Partial<Feedback> & { id: string }): Feedback {
  return {
    source: 'human',
    note: 'The plan tool refused a plan with two phases.',
    title: 'Plans with two phases are refused',
    body: 'The plan tool refused a plan with two phases, though two is the minimum.',
    status: 'draft',
    failure: null,
    issue: null,
    taskId: null,
    runId: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

export function createActions() {
  return {
    write: mock(async (_feedbackId: string | null, _note: string) => true),
    update: mock(async (_entry: Feedback, _title: string, _body: string) => true),
    file: mock(async (_entry: Feedback) => true),
    dismiss: mock(async (_entry: Feedback) => true),
  } satisfies FeedbackActions;
}

export function stateWith(entries: Feedback[]) {
  return createShinsaState({
    tasks: [createTask({ id: 't1', title: 'Fix the login page' })],
    projects: [createProject({ id: 'p1', name: 'Basket', key: 'BK' })],
    patch: { feedback: Object.fromEntries(entries.map((entry) => [entry.id, entry])) },
  });
}
