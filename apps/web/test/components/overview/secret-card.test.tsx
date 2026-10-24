import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NowCard } from '@/components/overview/now-card.tsx';
import { ReviewDraftProvider } from '@/components/task/review-draft.tsx';
import { spyOnToasts } from '../../support/commands.ts';
import { startFakeOnboarding } from '../../support/onboarding.ts';
import { listSentCommands, pushState, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createGate, createShinsaState, createTask } from '../../support/state.ts';

let fake: ReturnType<typeof startFakeOnboarding>;

let toasts: ReturnType<typeof spyOnToasts>;

beforeEach(() => {
  startFakeServer();
  toasts = spyOnToasts();
  fake = startFakeOnboarding({ 'POST /api/secrets/g-1': { answer: { ok: true } } });
});

afterEach(() => {
  fake.stop();
  toasts.restore();
  stopFakeServer();
});

function renderSecret() {
  const task = createTask({ id: 't-1' });
  const gate = createGate({
    id: 'g-1',
    taskId: 't-1',
    kind: 'question',
    purpose: 'agent_question',
    title: 'For the GitHub webhook.',
    secret: { label: 'GitHub webhook secret' },
  });
  const state = createShinsaState({ tasks: [task], gates: [gate] });
  pushState(state);
  return render(
    <TooltipProvider>
      <ReviewDraftProvider enabled draftKey={task.id}>
        <NowCard state={state} task={task} gate={gate} onOpen={mock()} />
      </ReviewDraftProvider>
    </TooltipProvider>
  );
}

describe('a secret request on the overview', () => {
  it('takes the value in a password field and posts it to the secret store, never as an answer', async () => {
    renderSecret();
    expect(screen.getByText('For the GitHub webhook.')).toBeDefined();
    expect(
      screen.getByText('It goes to Shinsa’s secret store. The agent and the chat never see it.')
    ).toBeDefined();
    const field = screen.getByLabelText('GitHub webhook secret') as HTMLInputElement;
    expect(field.type).toBe('password');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(field, { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(field.value).toBe(''));
    expect(fake.requests).toEqual([{ path: '/api/secrets/g-1', method: 'POST', body: { value: 'hunter2' } }]);
    expect(listSentCommands()).toEqual([]);
  });

  it('can be declined', async () => {
    renderSecret();
    fireEvent.click(screen.getByRole('button', { name: 'Don’t give it' }));
    await waitFor(() =>
      expect(fake.requests).toEqual([{ path: '/api/secrets/g-1', method: 'POST', body: { decline: true } }])
    );
  });

  it('keeps the value when saving fails', async () => {
    fake.stop();
    fake = startFakeOnboarding({
      'POST /api/secrets/g-1': { answer: { error: { message: 'Already answered.' } }, status: 400 },
    });
    renderSecret();
    const field = screen.getByLabelText('GitHub webhook secret') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'hunter2' } });
    fireEvent.submit(field.closest('form') as HTMLFormElement);
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('Already answered.'));
    expect(field.value).toBe('hunter2');
  });
});
