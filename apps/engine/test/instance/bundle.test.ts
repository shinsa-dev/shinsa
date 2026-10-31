import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { resolveSdkPackage } from '../../src/agents/providers/claude/executable.ts';
import { resolveConfig } from '../../src/config/index.ts';
import {
  BUNDLE,
  createServerInstance,
  resolveBundle,
  resolveBundlePath,
  resolveServerInstance,
} from '../../src/instance/index.ts';
import { createTempDir } from '../helpers/index.ts';

const FACTS = {
  version: '1.4.0',
  commit: 'c'.repeat(40),
  stateVersion: 'state',
  sdkVersion: '0.3.280',
  sdkClaudeVersion: '2.1.280',
};

function createBundle() {
  const bundle = resolveBundle(FACTS, '/Applications/Shinsa.app/Contents/Resources/engine/bin/shinsa');
  if (!bundle) throw new Error('no bundle');
  return bundle;
}

describe('the engine bundle', () => {
  test('exists only in a compiled engine, which carries its facts', () => {
    expect(BUNDLE).toBeNull();
    expect(resolveBundle({ ...FACTS, version: undefined })).toBeNull();
    expect(resolveBundle({ ...FACTS, sdkClaudeVersion: undefined })).toBeNull();
    expect(createBundle()).toEqual({
      version: '1.4.0',
      commit: 'c'.repeat(40),
      stateVersion: 'state',
      sdk: { version: '0.3.280', claudeCodeVersion: '2.1.280' },
      root: '/Applications/Shinsa.app/Contents/Resources/engine',
      bin: '/Applications/Shinsa.app/Contents/Resources/engine/bin',
    });
    expect(resolveBundle({ ...FACTS, commit: '' }, '/e/bin/shinsa')?.commit).toBeNull();
    expect(resolveBundlePath(createBundle(), 'web')).toBe(
      '/Applications/Shinsa.app/Contents/Resources/engine/web'
    );
  });

  test('a bundled engine reads its plugin, interface and versions from beside itself', async () => {
    const bundle = createBundle();
    const config = resolveConfig({ SHINSA_HOME: createTempDir() }, bundle);
    expect(config.pluginDir).toBe(join(bundle.root, 'plugin'));
    expect(config.webDir).toBe(join(bundle.root, 'web'));
    expect(resolveSdkPackage(undefined, bundle)).toEqual(bundle.sdk);
    expect(createServerInstance(null, 5, bundle).version).toBe('1.4.0');
    const instance = await resolveServerInstance('/nowhere', bundle);
    expect(instance).toMatchObject({ version: '1.4.0', commit: 'c'.repeat(40) });
  });
});
