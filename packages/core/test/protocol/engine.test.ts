import { describe, expect, test } from 'bun:test';
import { USER_COMMAND_TYPES } from '../../src/commands/index.ts';
import {
  DEVELOPMENT_VERSION,
  ENGINE_BASELINE_COMMANDS,
  ENGINE_FEATURES,
  ENGINE_PROTOCOL,
  type EngineCommand,
  hasEngineFeature,
  isEngineProtocolMatch,
  isPrereleaseVersion,
  parseEngineInfo,
  resolveEngineCommands,
  resolveEngineFit,
  resolveEngineInfo,
  resolveReleaseChannel,
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

describe('resolveReleaseChannel', () => {
  test('reads the channel a version was released on from its prerelease part', () => {
    expect(resolveReleaseChannel('1.3.0')).toBe('stable');
    expect(resolveReleaseChannel('v1.3.0+build')).toBe('stable');
    expect(resolveReleaseChannel('1.3.0-beta.2')).toBe('beta');
    expect(resolveReleaseChannel('1.3.1-canary.4')).toBe('canary');
    expect(resolveReleaseChannel('0.0.1-test.1')).toBe('beta');
    expect(resolveReleaseChannel('dev')).toBe('stable');
  });

  test('orders a canary above the beta and below the release of the same version', () => {
    expect(resolveVersionOrder('1.3.1-canary.4', '1.3.1-beta.1')).toBe(1);
    expect(resolveVersionOrder('1.3.1-canary.4', '1.3.1')).toBe(-1);
    expect(resolveVersionOrder('1.3.1-canary.10', '1.3.1-canary.9')).toBe(1);
    expect(resolveVersionOrder('1.3.1-canary.1', '1.3.0-beta.2')).toBe(1);
    expect(resolveVersionOrder('1.3.1-canary.1', '1.3.0')).toBe(1);
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

const GATED_COMMANDS: EngineCommand[] = [
  'task.stack_on',
  'feedback.write',
  'feedback.update',
  'feedback.file',
  'feedback.dismiss',
  'task.share',
  'task.unshare',
  'preview.share',
  'preview.unshare',
];

describe('ENGINE_BASELINE_COMMANDS', () => {
  test('lists only commands the engine parses', () => {
    for (const command of ENGINE_BASELINE_COMMANDS) expect(USER_COMMAND_TYPES).toContain(command);
  });

  test('leaves out every command added since, so a page offers it only where the engine says it parses it', () => {
    const gated = USER_COMMAND_TYPES.filter((command) => !ENGINE_BASELINE_COMMANDS.includes(command));
    expect(gated).toEqual(GATED_COMMANDS);
  });
});

describe('resolveEngineInfo', () => {
  test('announces the protocol, every command the engine parses and every feature', () => {
    expect(resolveEngineInfo('1.2.0')).toEqual({
      version: '1.2.0',
      protocol: ENGINE_PROTOCOL,
      commands: [...USER_COMMAND_TYPES],
      features: [...ENGINE_FEATURES],
    });
  });
});

describe('parseEngineInfo', () => {
  test('reads what an engine announced', () => {
    expect(parseEngineInfo(resolveEngineInfo('1.2.0'))).toEqual(resolveEngineInfo('1.2.0'));
  });

  test('reads loosely: a missing version is a development build and anything but strings is dropped', () => {
    expect(parseEngineInfo({ protocol: 2, commands: ['task.share', 3], features: 'task.share' })).toEqual({
      version: DEVELOPMENT_VERSION,
      protocol: 2,
      commands: ['task.share'],
      features: [],
    });
  });

  test('is null without a whole-number protocol', () => {
    expect(parseEngineInfo(null)).toBeNull();
    expect(parseEngineInfo('engine')).toBeNull();
    expect(parseEngineInfo({ version: '1.0.0' })).toBeNull();
    expect(parseEngineInfo({ protocol: 1.5 })).toBeNull();
  });
});

describe('resolveEngineCommands', () => {
  test('is the baseline for an engine that announced nothing', () => {
    const commands = resolveEngineCommands(null);
    expect(commands.has('task.create')).toBe(true);
    expect(commands.has('task.share')).toBe(false);
  });

  test('adds what the engine announced', () => {
    const commands = resolveEngineCommands(resolveEngineInfo('1.2.0'));
    for (const command of USER_COMMAND_TYPES) expect(commands.has(command)).toBe(true);
  });
});

describe('hasEngineFeature', () => {
  test('is true only for a feature the engine announced', () => {
    expect(hasEngineFeature(resolveEngineInfo('1.2.0'), 'task.share')).toBe(true);
    expect(hasEngineFeature({ ...resolveEngineInfo('1.2.0'), features: [] }, 'task.share')).toBe(false);
    expect(hasEngineFeature(null, 'task.share')).toBe(false);
  });
});

describe('isEngineProtocolMatch', () => {
  test('matches the same protocol and an engine that announced nothing', () => {
    expect(isEngineProtocolMatch(resolveEngineInfo('1.2.0'))).toBe(true);
    expect(isEngineProtocolMatch(null)).toBe(true);
  });

  test('refuses an engine on another protocol, older or newer', () => {
    const engine = resolveEngineInfo('1.2.0');
    expect(isEngineProtocolMatch({ ...engine, protocol: ENGINE_PROTOCOL - 1 })).toBe(false);
    expect(isEngineProtocolMatch({ ...engine, protocol: ENGINE_PROTOCOL + 1 })).toBe(false);
  });
});
