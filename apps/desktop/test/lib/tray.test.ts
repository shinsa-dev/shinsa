import { describe, expect, it } from 'bun:test';
import { describeTrayStatus, listTrayItems, TRAY_LABEL } from '../../src/lib/tray.ts';

describe('describeTrayStatus', () => {
  it('says whether the engine answers and how many agents are working', () => {
    expect(describeTrayStatus(null)).toBe('The engine is not answering');
    expect(describeTrayStatus({ version: '0.5.0', working: 0 })).toBe(
      'The engine is running. No agents are working'
    );
    expect(describeTrayStatus({ version: '0.5.0', working: 1 })).toBe(
      'The engine is running. 1 agent is working'
    );
    expect(describeTrayStatus({ version: null, working: 3 })).toBe(
      'The engine is running. 3 agents are working'
    );
  });
});

describe('listTrayItems', () => {
  it('shows the status, then Open, then Quit with the line that agents keep running', () => {
    expect(listTrayItems({ version: '0.5.0', working: 2 })).toEqual([
      { kind: 'status', label: 'The engine is running. 2 agents are working' },
      { kind: 'separator' },
      { kind: 'action', action: 'open', label: 'Open Shinsa' },
      { kind: 'separator' },
      { kind: 'action', action: 'quit', label: 'Quit Shinsa', sublabel: TRAY_LABEL.quitHint },
    ]);
  });
});
