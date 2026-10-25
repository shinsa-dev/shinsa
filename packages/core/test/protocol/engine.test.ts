import { describe, expect, test } from 'bun:test';
import { ENGINE_PROTOCOL, resolveEngineFit, resolveVersionOrder } from '../../src/protocol/engine.ts';

const app = (version: string, protocol = ENGINE_PROTOCOL) => ({ version, protocol });

describe('resolveVersionOrder', () => {
  test('orders versions by major, minor and patch, with or without a v', () => {
    expect(resolveVersionOrder('0.1.0', '0.2.0')).toBe(-1);
    expect(resolveVersionOrder('v1.0.0', '0.9.9')).toBe(1);
    expect(resolveVersionOrder('0.3.1', 'v0.3.1')).toBe(0);
    expect(resolveVersionOrder('0.3.1-beta.1', '0.3.0')).toBe(1);
  });

  test('has no order for something that is not a version', () => {
    expect(resolveVersionOrder('dev', '0.1.0')).toBeNull();
    expect(resolveVersionOrder('0.1.0', '1.2')).toBeNull();
  });
});

describe('resolveEngineFit', () => {
  test('a newer protocol in the engine means the app must update', () => {
    expect(resolveEngineFit(app('0.4.0', 1), app('0.5.0', 2))).toEqual({
      kind: 'update_app',
      required: true,
    });
  });

  test('an older protocol in the engine means it must restart into the app’s', () => {
    expect(resolveEngineFit(app('0.5.0', 2), app('0.4.0', 1))).toEqual({
      kind: 'restart_engine',
      required: true,
    });
  });

  test('on the same protocol an older engine restarts when it can, and a newer one asks for an app update', () => {
    expect(resolveEngineFit(app('0.5.0'), app('0.4.2'))).toEqual({ kind: 'restart_engine', required: false });
    expect(resolveEngineFit(app('0.4.2'), app('0.5.0'))).toEqual({ kind: 'update_app', required: false });
    expect(resolveEngineFit(app('0.5.0'), app('0.5.0'))).toEqual({ kind: 'match' });
  });

  test('a development build, or a version it cannot read, matches on the same protocol', () => {
    expect(resolveEngineFit(app('0.0.0'), app('0.5.0'))).toEqual({ kind: 'match' });
    expect(resolveEngineFit(app('0.5.0'), app('0.0.0'))).toEqual({ kind: 'match' });
    expect(resolveEngineFit(app('0.5.0'), app('main'))).toEqual({ kind: 'match' });
  });
});
