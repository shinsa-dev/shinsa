import { describe, expect, test } from 'bun:test';
import {
  ENGINE_PROTOCOL,
  isPrereleaseVersion,
  resolveEngineFit,
  resolveVersionOrder,
} from '../../src/protocol/engine.ts';

const app = (version: string, protocol = ENGINE_PROTOCOL) => ({ version, protocol });

describe('resolveVersionOrder', () => {
  test('orders versions by major, minor and patch, with or without a v', () => {
    expect(resolveVersionOrder('0.1.0', '0.2.0')).toBe(-1);
    expect(resolveVersionOrder('v1.0.0', '0.9.9')).toBe(1);
    expect(resolveVersionOrder('0.3.1', 'v0.3.1')).toBe(0);
    expect(resolveVersionOrder('0.3.1-beta.1', '0.3.0')).toBe(1);
  });

  test('puts a prerelease before its release and after the release before it, as semver does', () => {
    expect(resolveVersionOrder('1.3.0-beta.2', '1.3.0')).toBe(-1);
    expect(resolveVersionOrder('1.3.0', '1.3.0-beta.2')).toBe(1);
    expect(resolveVersionOrder('1.3.0-beta.2', '1.2.9')).toBe(1);
    expect(resolveVersionOrder('1.3.0-beta.2', '1.3.0-beta.10')).toBe(-1);
    expect(resolveVersionOrder('1.3.0-beta.2', 'v1.3.0-beta.2')).toBe(0);
    expect(resolveVersionOrder('1.3.0-alpha.1', '1.3.0-beta.1')).toBe(-1);
    expect(resolveVersionOrder('1.3.0-beta', '1.3.0-beta.1')).toBe(-1);
    expect(resolveVersionOrder('1.3.0-beta.1', '1.3.0-beta')).toBe(1);
    expect(resolveVersionOrder('1.3.0-1', '1.3.0-beta')).toBe(-1);
    expect(resolveVersionOrder('1.3.0-beta', '1.3.0-1')).toBe(1);
    expect(resolveVersionOrder('1.3.0-rc', '1.3.0-beta')).toBe(1);
  });

  test('ignores build metadata', () => {
    expect(resolveVersionOrder('1.3.0+abc', '1.3.0')).toBe(0);
  });

  test('has no order for something that is not a version', () => {
    expect(resolveVersionOrder('dev', '0.1.0')).toBeNull();
    expect(resolveVersionOrder('0.1.0', '1.2')).toBeNull();
  });
});

describe('isPrereleaseVersion', () => {
  test('is true only for a version with a prerelease part', () => {
    expect(isPrereleaseVersion('1.3.0-beta.2')).toBe(true);
    expect(isPrereleaseVersion('v1.3.0')).toBe(false);
    expect(isPrereleaseVersion('1.3.0+build')).toBe(false);
    expect(isPrereleaseVersion('dev')).toBe(false);
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

  test('an engine on the beta of the version the app ships restarts into the release', () => {
    expect(resolveEngineFit(app('1.3.0'), app('1.3.0-beta.2'))).toEqual({
      kind: 'restart_engine',
      required: false,
    });
    expect(resolveEngineFit(app('1.3.0-beta.2'), app('1.3.0-beta.1'))).toEqual({
      kind: 'restart_engine',
      required: false,
    });
    expect(resolveEngineFit(app('1.3.0-beta.2'), app('1.3.0-beta.2'))).toEqual({ kind: 'match' });
  });

  test('a development build, or a version it cannot read, matches on the same protocol', () => {
    expect(resolveEngineFit(app('0.0.0'), app('0.5.0'))).toEqual({ kind: 'match' });
    expect(resolveEngineFit(app('0.5.0'), app('0.0.0'))).toEqual({ kind: 'match' });
    expect(resolveEngineFit(app('0.5.0'), app('main'))).toEqual({ kind: 'match' });
  });
});
