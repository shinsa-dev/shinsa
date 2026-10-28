import { describe, expect, it } from 'bun:test';
import {
  APP_NAME,
  DEV_BUNDLE_ID,
  listPlistEdits,
  resolveDevBundle,
  resolveUserDataDir,
  serializeDevBundleStamp,
} from '../../src/lib/dev-bundle.ts';

const ELECTRON = '/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron';

describe('resolveDevBundle', () => {
  it('copies Electron.app to a Shinsa.app beside the package and runs its binary', () => {
    expect(resolveDevBundle({ electronBinary: ELECTRON, desktopDir: '/repo/apps/desktop' })).toEqual({
      source: '/repo/node_modules/electron/dist/Electron.app',
      bundle: '/repo/apps/desktop/.electron/Shinsa.app',
      binary: '/repo/apps/desktop/.electron/Shinsa.app/Contents/MacOS/Electron',
      plist: '/repo/apps/desktop/.electron/Shinsa.app/Contents/Info.plist',
      icon: '/repo/apps/desktop/.electron/Shinsa.app/Contents/Resources/electron.icns',
      stamp: '/repo/apps/desktop/.electron/Shinsa.json',
    });
  });
});

describe('listPlistEdits', () => {
  it('names the bundle Shinsa in the menu bar, the Dock and notifications, under its own id', () => {
    expect(APP_NAME).toBe('Shinsa');
    expect(listPlistEdits('/b/Info.plist')).toEqual([
      ['-replace', 'CFBundleName', '-string', 'Shinsa', '/b/Info.plist'],
      ['-replace', 'CFBundleDisplayName', '-string', 'Shinsa', '/b/Info.plist'],
      ['-replace', 'CFBundleIdentifier', '-string', DEV_BUNDLE_ID, '/b/Info.plist'],
    ]);
  });
});

describe('resolveUserDataDir', () => {
  it('keeps each app’s window, channel and single-instance lock in a folder of its own', () => {
    const appData = '/Users/me/Library/Application Support';
    expect(resolveUserDataDir(appData, true, undefined)).toBe(`${appData}/Shinsa`);
    expect(resolveUserDataDir(appData, false, undefined)).toBe(`${appData}/Shinsa Dev`);
    expect(resolveUserDataDir(appData, true, 'studio.overclock.shinsa.test')).toBe(
      `${appData}/studio.overclock.shinsa.test`
    );
    expect(resolveUserDataDir(appData, true)).toBe(`${appData}/Shinsa`);
  });
});

describe('serializeDevBundleStamp', () => {
  it('changes with the Electron version and the icon, so a stale copy is rebuilt', () => {
    const stamp = serializeDevBundleStamp('44.9.3', 1200);
    expect(serializeDevBundleStamp('44.9.3', 1200)).toBe(stamp);
    expect(serializeDevBundleStamp('45.0.0', 1200)).not.toBe(stamp);
    expect(serializeDevBundleStamp('44.9.3', null)).not.toBe(stamp);
  });
});
