import type { EventOf, ShinsaEvent } from '../events/index.ts';
import type { ShinsaState } from './project.ts';
import { record, updateTask } from './write.ts';

type WaitEvent = Extract<
  ShinsaEvent,
  { type: 'monitor.armed' | 'monitor.fired' | 'monitor.ended' | 'usage_wait.armed' | 'usage_wait.ended' }
>;

function applyMonitorFired(state: ShinsaState, event: EventOf<'monitor.fired'>) {
  const monitor = state.tasks[event.taskId]?.monitor;
  if (monitor?.id !== event.monitorId) return;
  updateTask(state, event.taskId, event.at, {
    monitor: { ...monitor, status: 'fired', attempts: event.attempt },
  });
  record(state, event.taskId, event.at, {
    actor: 'shinsa',
    kind: 'monitor',
    text: `Woke an agent to check again (check ${event.attempt} of ${monitor.maxAttempts})`,
    detail: monitor.notes,
  });
}

function applyMonitorEnded(state: ShinsaState, event: EventOf<'monitor.ended'>) {
  const monitor = state.tasks[event.taskId]?.monitor;
  if (monitor?.id !== event.monitorId) return;
  updateTask(state, event.taskId, event.at, {
    monitor: event.status === 'cleared' ? null : { ...monitor, status: event.status },
  });
}

function applyUsageWaitArmed(state: ShinsaState, event: EventOf<'usage_wait.armed'>) {
  const previous = state.tasks[event.taskId]?.usageWait;
  updateTask(state, event.taskId, event.at, { usageWait: event.wait });
  if (previous?.status === 'armed' && previous.resetAt === event.wait.resetAt) return;
  record(state, event.taskId, event.at, {
    actor: 'shinsa',
    kind: 'account',
    text: event.wait.autoResume
      ? 'Hit the usage limit; resumes when it resets'
      : 'Hit the usage limit; waits for it to reset',
    runId: event.wait.runId,
  });
}

function applyUsageWaitEnded(state: ShinsaState, event: EventOf<'usage_wait.ended'>) {
  const wait = state.tasks[event.taskId]?.usageWait;
  if (wait?.id !== event.waitId) return;
  if (event.status === 'cleared') {
    updateTask(state, event.taskId, event.at, { usageWait: null });
    return;
  }
  if (event.status === 'reset') {
    updateTask(state, event.taskId, event.at, { usageWait: null });
    record(state, event.taskId, event.at, {
      actor: 'shinsa',
      kind: 'account',
      text: 'The usage limit reset',
    });
    return;
  }
  updateTask(state, event.taskId, event.at, { usageWait: { ...wait, status: 'resumed' } });
  record(state, event.taskId, event.at, {
    actor: 'shinsa',
    kind: 'account',
    text:
      event.at >= wait.resetAt
        ? 'Resumed after the usage limit reset'
        : 'Resumed before the usage limit reset',
  });
}

export function applyWaitEvent(state: ShinsaState, event: WaitEvent) {
  switch (event.type) {
    case 'monitor.armed':
      updateTask(state, event.taskId, event.at, { monitor: event.monitor });
      record(state, event.taskId, event.at, {
        actor: 'agent',
        kind: 'monitor',
        text: 'Set a check for later and ended its turn',
        detail: event.monitor.notes,
        runId: event.monitor.runId,
      });
      return;
    case 'monitor.fired':
      applyMonitorFired(state, event);
      return;
    case 'monitor.ended':
      applyMonitorEnded(state, event);
      return;
    case 'usage_wait.armed':
      applyUsageWaitArmed(state, event);
      return;
    case 'usage_wait.ended':
      applyUsageWaitEnded(state, event);
      return;
  }
}
