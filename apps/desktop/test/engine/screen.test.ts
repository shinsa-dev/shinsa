import { describe, expect, it } from 'bun:test';
import { ENGINE_ACTION_LABEL, type EngineScreen } from '../../src/engine/schema.ts';
import {
  describeEngineScreen,
  parseEngineAction,
  resolveLogTail,
  resolveWaitingQuery,
  selectBusyPort,
} from '../../src/engine/screen.ts';

describe('the engine log', () => {
  it('keeps the warnings, errors and plain lines, once each, in plain words', () => {
    const log = [
      '{"level":"info","message":"[Serve] Ready"}',
      '{"level":"warn","message":"[Accounts] Could not check","error":"offline"}',
      '{"level":"error","message":"[Serve] Could not stop"}',
      '{"level":"warn","error":3}',
      '{not json',
      '',
      'shinsa engine: Failed to start server. Is port 5199 in use?',
      'shinsa engine: Failed to start server. Is port 5199 in use?',
    ].join('\n');
    expect(resolveLogTail(log)).toBe(
      [
        '[Accounts] Could not check: offline',
        '[Serve] Could not stop',
        '{not json',
        'shinsa engine: Failed to start server. Is port 5199 in use?',
      ].join('\n')
    );
    expect(resolveLogTail(log, 1)).toBe('shinsa engine: Failed to start server. Is port 5199 in use?');
    expect(selectBusyPort(log)).toBe(5199);
    expect(selectBusyPort('fine')).toBeNull();
  });
});

describe('the status screen', () => {
  it('says what is happening and offers only what fixes it', () => {
    const screens: EngineScreen[] = [
      { kind: 'starting' },
      { kind: 'dev' },
      { kind: 'approval' },
      { kind: 'crashing', detail: 'log' },
      { kind: 'port', port: 5180, detail: 'log' },
      { kind: 'stopped', detail: 'log' },
    ];
    const views = screens.map((screen) => describeEngineScreen(screen));
    expect(views.map((view) => view.title)).toEqual([
      'Starting Shinsa',
      'Waiting for Shinsa',
      'Allow Shinsa to run in the background',
      'Shinsa’s engine keeps stopping',
      'Port 5180 is taken',
      'Shinsa’s engine is not running',
    ]);
    expect(views.map((view) => view.actions)).toEqual([
      [],
      [],
      ['open-login-items', 'retry'],
      ['restart', 'copy-details'],
      ['restart', 'copy-details'],
      ['restart', 'open-privacy', 'copy-details'],
    ]);
    expect(views.map((view) => view.busy)).toEqual([true, true, false, false, false, false]);
    expect(views[3]?.detail).toBe('log');
  });

  it('takes an action only from its own links', () => {
    for (const action of Object.keys(ENGINE_ACTION_LABEL))
      expect(parseEngineAction(`shinsa://engine/${action}`)).toBe(action as never);
    expect(parseEngineAction('shinsa://engine/format-disk')).toBeNull();
    expect(parseEngineAction('shinsa://task/SW-1')).toBeNull();
  });
});

describe('the waiting page query', () => {
  it('carries the view and its actions with their labels', () => {
    expect(resolveWaitingQuery(describeEngineScreen({ kind: 'stopped', detail: 'exit 1' }))).toMatchObject({
      detail: 'exit 1',
      busy: '',
      actions: 'restart:Start engine|open-privacy:Open Privacy & Security|copy-details:Copy details',
    });
    expect(resolveWaitingQuery(describeEngineScreen({ kind: 'starting' })).busy).toBe('1');
  });
});
