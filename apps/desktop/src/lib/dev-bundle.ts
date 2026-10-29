import { dirname, join } from 'node:path';
import { APP_IDENTITY } from '@shinsa/core';

export const APP_NAME = APP_IDENTITY.appName;

export const DEV_BUNDLE_ID = 'studio.overclock.shinsa.dev';

const DEV_BUNDLE_KEYS = {
  CFBundleName: APP_NAME,
  CFBundleDisplayName: APP_NAME,
  CFBundleIdentifier: DEV_BUNDLE_ID,
} as const;

export function resolveUserDataDir(appData: string, packaged: boolean, appId = process.env.SHINSA_APP_ID) {
  if (!packaged) return join(appData, `${APP_NAME} Dev`);
  return join(appData, appId || APP_NAME);
}

export function resolveDevBundle({
  electronBinary,
  desktopDir,
}: {
  electronBinary: string;
  desktopDir: string;
}) {
  const source = dirname(dirname(dirname(electronBinary)));
  const folder = join(desktopDir, '.electron');
  const bundle = join(folder, `${APP_NAME}.app`);
  return {
    source,
    bundle,
    binary: join(bundle, 'Contents', 'MacOS', 'Electron'),
    plist: join(bundle, 'Contents', 'Info.plist'),
    icon: join(bundle, 'Contents', 'Resources', 'electron.icns'),
    stamp: join(folder, `${APP_NAME}.json`),
  };
}

export function serializeDevBundleStamp(electronVersion: string, iconSize: number | null) {
  return JSON.stringify({ electronVersion, iconSize, keys: DEV_BUNDLE_KEYS });
}

export function listPlistEdits(plist: string) {
  return Object.entries(DEV_BUNDLE_KEYS).map(([key, value]) => ['-replace', key, '-string', value, plist]);
}
