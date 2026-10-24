import type { Monitor } from '../domain/index.ts';

function resolveNextMove(monitor: Monitor, attempt: number) {
  if (attempt >= monitor.maxAttempts) {
    return 'This is your last check: if it is not ready, finish the step with what you know, or ask the human with `ask`. Waiting again ends your step and asks the human what to do.';
  }
  return 'If you still need to wait, call `wait_for` again with a new `check_in_minutes`; your checks and the timeout carry over.';
}

export function resolveMonitorPrompt(monitor: Monitor, attempt: number) {
  return [
    `Shinsa woke you to check again (check ${attempt} of ${monitor.maxAttempts}).`,
    `You were waiting for: ${monitor.notes}`,
    '',
    'Check it now. If it is ready, carry on with your step and finish it with the hand-over tool.',
    resolveNextMove(monitor, attempt),
    'Do not sleep or poll in a shell.',
  ].join('\n');
}
