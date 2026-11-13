import { describe, expect, test } from 'bun:test';
import { Result } from 'effect';
import { APP_ENGINE_TARGET } from '../../src/instance/schema.ts';
import { resolveBuildFolder, resolveBuildTarget } from '../../src/instance/targets.ts';

describe('the engine build targets', () => {
  test('build the Mac app engine when none is named', () => {
    expect(resolveBuildTarget(undefined)).toEqual(Result.succeed(APP_ENGINE_TARGET));
    expect(resolveBuildTarget('')).toEqual(Result.succeed(APP_ENGINE_TARGET));
  });

  test('accept the Linux targets', () => {
    expect(resolveBuildTarget('bun-linux-x64')).toEqual(Result.succeed('bun-linux-x64'));
    expect(resolveBuildTarget('bun-linux-arm64')).toEqual(Result.succeed('bun-linux-arm64'));
  });

  test('refuse a target it does not build, naming the ones it does', () => {
    expect(Result.flip(resolveBuildTarget('bun-windows-x64'))).toMatchObject({
      success: {
        _tag: 'EngineTargetUnknown',
        target: 'bun-windows-x64',
        message:
          'Unknown engine target bun-windows-x64: use one of bun-darwin-arm64, bun-darwin-x64, bun-linux-x64, bun-linux-arm64',
      },
    });
  });

  test('keep the app engine where the Mac app packs it, and every other target beside it', () => {
    expect(resolveBuildFolder('bun-darwin-arm64')).toBe('engine');
    expect(resolveBuildFolder('bun-linux-x64')).toBe('engine-linux-x64');
    expect(resolveBuildFolder('bun-linux-arm64')).toBe('engine-linux-arm64');
    expect(resolveBuildFolder('bun-darwin-x64')).toBe('engine-darwin-x64');
  });
});
