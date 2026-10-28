import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_FLAVORS } from '@shinsa/core';

const desktopDir = join(import.meta.dirname, '../..');

interface BuilderConfig {
  extends?: string;
  appId?: string;
  productName?: string;
  extraMetadata?: { productName?: string };
  extraFiles?: { from: string; to: string }[];
  protocols?: { name: string; schemes: string[] }[];
  mac?: { icon?: string };
  dmg?: { background?: string };
}

function readConfig(name: string) {
  return Bun.YAML.parse(readFileSync(join(desktopDir, name), 'utf8')) as BuilderConfig;
}

function readIdentity(flavor: string) {
  const script = [
    "import { APP_ID, ENGINE_LABEL, resolveDataDir } from './src/lib/engine.ts';",
    "import { APP_NAME } from './src/lib/dev-bundle.ts';",
    "import { URL_SCHEME } from './src/lib/deep-link.ts';",
    "import { resolveCommandLink } from './src/lib/command-line.ts';",
    "import { resolveServerUrl } from './src/lib/server-url.ts';",
    "import { resolveUpdateChannel } from './src/lib/update-channel.ts';",
    'console.log(JSON.stringify({ APP_ID, ENGINE_LABEL, APP_NAME, URL_SCHEME,',
    "  command: resolveCommandLink('/u'), data: resolveDataDir({}, '/u'),",
    '  url: resolveServerUrl({ env: {}, packaged: true, configPort: null }),',
    "  channel: resolveUpdateChannel('beta', '1.0.0') }));",
  ].join('\n');
  const env = { ...process.env, SHINSA_BUILD_FLAVOR: flavor, SHINSA_APP_ID: '' };
  const result = Bun.spawnSync([process.execPath, '-e', script], { cwd: desktopDir, env });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return JSON.parse(result.stdout.toString()) as Record<string, string>;
}

describe('the Shinsa Canary build', () => {
  const shared = readConfig('electron-builder.shared.yml');
  const builds = {
    stable: readConfig('electron-builder.yml'),
    canary: readConfig('electron-builder.canary.yml'),
  };

  it('shares everything but what names the app, since electron-builder joins the lists it extends', () => {
    for (const key of ['appId', 'productName', 'extraFiles', 'protocols'] as const)
      expect(shared[key]).toBeUndefined();
    expect(shared.mac?.icon).toBeUndefined();
    expect(shared.dmg?.background).toBeUndefined();
  });

  it('gives each app its own bundle id, name, URL scheme, icon, disk image and engine job', () => {
    for (const flavor of ['stable', 'canary'] as const) {
      const { appId, appName, scheme } = APP_FLAVORS[flavor];
      const build = builds[flavor];
      expect(build.extends).toBe('electron-builder.shared.yml');
      expect(build).toMatchObject({ appId, productName: appName });
      expect(build.protocols).toEqual([{ name: appName, schemes: [scheme] }]);
      for (const file of [build.mac?.icon, build.dmg?.background])
        expect(existsSync(join(desktopDir, 'resources', file ?? 'missing'))).toBe(true);
      const [agents, ...more] = build.extraFiles ?? [];
      expect(more).toEqual([]);
      expect(agents?.to).toBe('Library/LaunchAgents');
      expect(Array.from(new Bun.Glob('*').scanSync(join(desktopDir, agents?.from ?? 'missing')))).toEqual([
        `${appId}.engine.plist`,
      ]);
    }
    expect(builds.canary.extraMetadata).toEqual({ productName: APP_FLAVORS.canary.appName });
    expect(builds.canary.mac?.icon).not.toBe(builds.stable.mac?.icon);
  });

  it('bakes its identity into the app, so it never meets Shinsa’s job, data, port, link or command', () => {
    expect(readIdentity('canary')).toEqual({
      APP_ID: 'studio.overclock.shinsa.canary',
      ENGINE_LABEL: 'studio.overclock.shinsa.canary.engine',
      APP_NAME: 'Shinsa Canary',
      URL_SCHEME: 'shinsa-canary',
      command: '/u/.local/bin/shinsa-canary',
      data: '/u/.config/shinsa-canary/data',
      url: 'http://127.0.0.1:7447',
      channel: 'canary',
    });
    expect(readIdentity('stable')).toMatchObject({ APP_ID: 'studio.overclock.shinsa', channel: 'beta' });
  });
});
