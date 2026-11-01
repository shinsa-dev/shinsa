import { describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_IDENTITY } from '@shinsa/core';

const desktopDir = join(import.meta.dirname, '../..');

interface BuilderConfig {
  extends?: string;
  appId?: string;
  productName?: string;
  extraFiles?: { from: string; to: string }[];
  protocols?: { name: string; schemes: string[] }[];
  mac?: { icon?: string };
  dmg?: { background?: string };
  extraResources?: { from: string; to: string }[];
  publish?: Record<string, string | boolean>;
}

function readYaml(name: string) {
  return Bun.YAML.parse(readFileSync(join(desktopDir, name), 'utf8'));
}

function readConfig(name: string) {
  return readYaml(name) as BuilderConfig;
}

function readIdentity() {
  const script = [
    "import { APP_ID, ENGINE_LABEL, resolveDataDir } from './src/lib/engine.ts';",
    "import { APP_NAME } from './src/lib/dev-bundle.ts';",
    "import { URL_SCHEME } from './src/lib/deep-link.ts';",
    "import { resolveCommandLink } from './src/lib/command-line.ts';",
    "import { resolveServerUrl } from './src/lib/server-url.ts';",
    "import { UPDATE_FEED } from './src/lib/update-channel.ts';",
    'console.log(JSON.stringify({ APP_ID, ENGINE_LABEL, APP_NAME, URL_SCHEME,',
    "  command: resolveCommandLink('/u'), data: resolveDataDir({}, '/u'),",
    '  url: resolveServerUrl({ env: {}, packaged: true, configPort: null }), feed: UPDATE_FEED }));',
  ].join('\n');
  const env = { ...process.env, SHINSA_APP_ID: '' };
  const result = Bun.spawnSync([process.execPath, '-e', script], { cwd: desktopDir, env });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return JSON.parse(result.stdout.toString()) as Record<string, unknown>;
}

describe('the Shinsa build', () => {
  const shared = readConfig('electron-builder.shared.yml');
  const build = readConfig('electron-builder.yml');

  it('is the one app every channel builds, so a canary or a beta updates Shinsa in place', () => {
    expect(
      readdirSync(desktopDir)
        .filter((name) => name.startsWith('electron-builder.'))
        .sort()
    ).toEqual(['electron-builder.shared.yml', 'electron-builder.yml']);
    for (const key of ['appId', 'productName', 'extraFiles', 'protocols'] as const)
      expect(shared[key]).toBeUndefined();
    const { appId, appName, scheme } = APP_IDENTITY;
    expect(build.extends).toBe('electron-builder.shared.yml');
    expect(build).toMatchObject({ appId, productName: appName });
    expect(build.protocols).toEqual([{ name: appName, schemes: [scheme] }]);
    expect(build.extraFiles).toEqual([{ from: 'resources/LaunchAgents', to: 'Library/LaunchAgents' }]);
    expect(readdirSync(join(desktopDir, 'resources/LaunchAgents'))).toEqual([`${appId}.engine.plist`]);
  });

  it('bundles app-update.yml, which electron-updater reads before every download', () => {
    expect(shared.extraResources).toContainEqual({ from: 'resources/app-update.yml', to: 'app-update.yml' });
    expect(shared.publish).toEqual(readIdentity().feed as Record<string, string | boolean>);
    expect(readYaml('resources/app-update.yml')).toEqual({
      ...shared.publish,
      updaterCacheDirName: 'shinsa-updater',
    });
  });

  it('has a disk image background for each channel', () => {
    expect(existsSync(join(desktopDir, 'resources', build.mac?.icon ?? 'missing'))).toBe(true);
    for (const channel of ['stable', 'beta', 'canary'])
      expect(existsSync(join(desktopDir, 'resources/dmg', `background-${channel}.png`))).toBe(true);
    expect(build.dmg?.background).toBe('dmg/background-stable.png');
  });

  it('bakes in Shinsa’s job, data, port, link and command', () => {
    expect(readIdentity()).toEqual({
      APP_ID: 'studio.overclock.shinsa',
      ENGINE_LABEL: 'studio.overclock.shinsa.engine',
      APP_NAME: 'Shinsa',
      URL_SCHEME: 'shinsa',
      command: '/u/.local/bin/shinsa',
      data: '/u/.config/shinsa/data',
      url: 'http://127.0.0.1:7446',
      feed: { provider: 'generic', url: 'https://shinsa.dev/updates', useMultipleRangeRequest: false },
    });
  });
});
