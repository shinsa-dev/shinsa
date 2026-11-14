import { afterEach, describe, expect, it } from 'bun:test';
import {
  recordHoveredTask,
  removeHoveredTask,
  resolveHoveredTask,
  resolveOpeningStack,
  trackHoveredTasks,
} from '@/lib/command/hover.ts';
import { createShinsaState, createTask } from '../../support/state.ts';

const state = createShinsaState({ tasks: [createTask({ id: 'billing', title: 'Rework billing emails' })] });

function createRow(taskId: string) {
  const row = document.createElement('a');
  const handle = document.createElement('span');
  handle.setAttribute('data-task', taskId);
  row.append(handle);
  document.body.append(row);
  return handle;
}

afterEach(() => {
  removeHoveredTask();
  document.body.replaceChildren();
});

describe('resolveHoveredTask', () => {
  it('finds the task under the pointer on Home and All tasks only', () => {
    recordHoveredTask(createRow('billing'));
    expect(resolveHoveredTask(state, { name: 'home' })?.id).toBe('billing');
    expect(resolveHoveredTask(state, { name: 'tasks' })?.id).toBe('billing');
    expect(resolveHoveredTask(state, { name: 'settings' })).toBeNull();
  });

  it('finds nothing for a task that is gone or a pointer over no task', () => {
    recordHoveredTask(createRow('gone'));
    expect(resolveHoveredTask(state, { name: 'home' })).toBeNull();
    recordHoveredTask(document.body);
    expect(resolveHoveredTask(state, { name: 'home' })).toBeNull();
  });
});

describe('resolveOpeningStack', () => {
  it('opens on the hovered task’s page, and on the root without one', () => {
    expect(resolveOpeningStack(state, { name: 'home' }, null)).toEqual([]);
    recordHoveredTask(createRow('billing'));
    const [visit] = resolveOpeningStack(state, { name: 'home' }, null);
    expect(visit?.from).toBe('');
    expect(visit?.frame.kind === 'list' && visit.frame.crumb).toBe('Rework billing emails');
  });
});

describe('trackHoveredTasks', () => {
  it('follows the pointer until paused, forgets on leaving the window and on stop', () => {
    let paused = false;
    const stop = trackHoveredTasks(() => paused);
    const handle = createRow('billing');
    handle.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    expect(resolveHoveredTask(state, { name: 'home' })?.id).toBe('billing');
    paused = true;
    document.body.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    document.body.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }));
    expect(resolveHoveredTask(state, { name: 'home' })?.id).toBe('billing');
    paused = false;
    handle.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body }));
    expect(resolveHoveredTask(state, { name: 'home' })?.id).toBe('billing');
    handle.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }));
    expect(resolveHoveredTask(state, { name: 'home' })).toBeNull();
    handle.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    stop();
    expect(resolveHoveredTask(state, { name: 'home' })).toBeNull();
    handle.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    expect(resolveHoveredTask(state, { name: 'home' })).toBeNull();
  });
});
