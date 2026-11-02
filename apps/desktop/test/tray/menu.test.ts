import { describe, expect, it } from 'bun:test';
import { describeTrayStatus, listTrayItems, resolveTrayTitle } from '../../src/tray/menu.ts';
import { TRAY_LABEL, TRAY_TASK_LIMIT, type TrayQueue } from '../../src/tray/schema.ts';

const HEALTH = { version: '0.5.0', working: 2, updating: false };

function createTask(index: number) {
  return { path: `/tasks/LOC-${index}`, title: `Task ${index}`, detail: `Review · LOC-${index}` };
}

describe('describeTrayStatus', () => {
  it('says whether the engine answers and how many agents are working', () => {
    expect(describeTrayStatus(null)).toBe('The engine is not answering');
    expect(describeTrayStatus({ ...HEALTH, working: 0 })).toBe(
      'The engine is running. No agents are working'
    );
    expect(describeTrayStatus({ ...HEALTH, working: 1 })).toBe('The engine is running. 1 agent is working');
    expect(describeTrayStatus({ ...HEALTH, version: null, working: 3 })).toBe(
      'The engine is running. 3 agents are working'
    );
  });

  it('leaves the count to the Working list once the engine sent its tasks', () => {
    expect(describeTrayStatus(HEALTH, { decisions: [], working: [] })).toBe('The engine is running');
  });
});

describe('resolveTrayTitle', () => {
  it('shows how many decisions wait for you beside the icon, and nothing otherwise', () => {
    expect(resolveTrayTitle(null)).toBe('');
    expect(resolveTrayTitle({ decisions: [], working: [createTask(1)] })).toBe('');
    expect(resolveTrayTitle({ decisions: [createTask(1), createTask(2)], working: [] })).toBe('2');
  });
});

describe('listTrayItems', () => {
  it('shows the status, then Open, then Quit with the line that agents keep running', () => {
    expect(listTrayItems(HEALTH)).toEqual([
      { kind: 'status', label: 'The engine is running. 2 agents are working' },
      { kind: 'separator' },
      { kind: 'action', action: 'open', label: 'Open Shinsa' },
      { kind: 'separator' },
      { kind: 'action', action: 'quit', label: 'Quit Shinsa', sublabel: TRAY_LABEL.quitHint },
    ]);
  });

  it('lists what needs you and what is working, each task opening its page', () => {
    const queue: TrayQueue = { decisions: [createTask(1)], working: [createTask(2)] };
    expect(listTrayItems({ ...HEALTH, updating: true }, queue)).toEqual([
      { kind: 'status', label: 'The engine is running' },
      { kind: 'status', label: TRAY_LABEL.updating },
      { kind: 'separator' },
      { kind: 'header', label: 'Needs you (1)' },
      { kind: 'task', path: '/tasks/LOC-1', label: 'Task 1', sublabel: 'Review · LOC-1' },
      { kind: 'separator' },
      { kind: 'header', label: 'Working (1)' },
      { kind: 'task', path: '/tasks/LOC-2', label: 'Task 2', sublabel: 'Review · LOC-2' },
      { kind: 'separator' },
      { kind: 'action', action: 'open', label: 'Open Shinsa' },
      { kind: 'separator' },
      { kind: 'action', action: 'quit', label: 'Quit Shinsa', sublabel: TRAY_LABEL.quitHint },
    ]);
  });

  it('shows the first few of a long list and a line that opens Home for the rest', () => {
    const decisions = Array.from({ length: TRAY_TASK_LIMIT + 2 }, (_, index) => createTask(index));
    const items = listTrayItems(HEALTH, { decisions, working: [] });
    expect(items.filter((item) => item.kind === 'task')).toHaveLength(TRAY_TASK_LIMIT + 1);
    expect(items).toContainEqual({ kind: 'task', path: '/', label: '2 more', sublabel: 'Open Home' });
    expect(items).toContainEqual({ kind: 'header', label: `Needs you (${TRAY_TASK_LIMIT + 2})` });
  });

  it('leaves the tasks out while the engine does not answer', () => {
    const items = listTrayItems(null, { decisions: [createTask(1)], working: [] });
    expect(items.some((item) => item.kind === 'task')).toBe(false);
  });
});
