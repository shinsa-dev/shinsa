import { describe, expect, it } from 'bun:test';
import {
  DOWNGRADE_ACCEPT,
  describeDowngradeDialog,
  describeManualResult,
  describeReadyNotice,
  describeUpdateFailure,
  describeUpdateItem,
  isUpdateSupported,
  needsDiscard,
  resolveDesktopUpdate,
  resolveInitialUpdate,
  resolveStagedUpdate,
  UPDATE_CHECK_MS,
} from '../../src/lib/update.ts';

describe('isUpdateSupported', () => {
  it('updates only the packaged Mac app, never a development run', () => {
    expect(isUpdateSupported({ packaged: true, platform: 'darwin', updateFile: true })).toBe(true);
    expect(isUpdateSupported({ packaged: false, platform: 'darwin', updateFile: true })).toBe(false);
    expect(isUpdateSupported({ packaged: true, platform: 'linux', updateFile: true })).toBe(false);
  });

  it('never updates a packaged build without its update file, such as a local package', () => {
    expect(isUpdateSupported({ packaged: true, platform: 'darwin', updateFile: false })).toBe(false);
  });

  it('starts idle when it can update, and says so when it cannot', () => {
    expect(resolveInitialUpdate(true)).toEqual({ status: 'idle' });
    expect(resolveInitialUpdate(false)).toEqual({ status: 'unavailable' });
  });

  it('checks every four hours', () => {
    expect(UPDATE_CHECK_MS).toBe(14_400_000);
  });
});

describe('describeUpdateItem', () => {
  it('offers a check while nothing is happening, and after a check or a failure', () => {
    const check = { label: 'Check for Updates…', enabled: true, install: false };
    expect(describeUpdateItem({ status: 'idle' })).toEqual(check);
    expect(describeUpdateItem({ status: 'current', latest: null })).toEqual(check);
    expect(describeUpdateItem({ status: 'failed', message: 'offline' })).toEqual(check);
  });

  it('shows the check and the download in progress, and cannot be clicked meanwhile', () => {
    expect(describeUpdateItem({ status: 'checking', manual: false })).toEqual({
      label: 'Checking for Updates…',
      enabled: false,
      install: false,
    });
    expect(describeUpdateItem({ status: 'downloading', version: '0.3.0', percent: 41.7 })).toEqual({
      label: 'Downloading Shinsa 0.3.0… 41%',
      enabled: false,
      install: false,
    });
  });

  it('offers to restart once the update is downloaded', () => {
    expect(describeUpdateItem({ status: 'ready', version: '0.3.0' })).toEqual({
      label: 'Restart to Update to 0.3.0',
      enabled: true,
      install: true,
    });
  });
});

describe('describeReadyNotice', () => {
  it('says when the update installs and that agents are not interrupted', () => {
    expect(describeReadyNotice('0.3.0')).toEqual({
      title: 'Shinsa 0.3.0 is ready',
      body: 'It installs the next time you quit Shinsa, or restart now from the Shinsa menu. Agents keep working either way.',
    });
  });
});

describe('describeManualResult', () => {
  it('answers a check you asked for when there is nothing new or it failed, naming the channel', () => {
    expect(describeManualResult({ status: 'current', latest: '0.2.0' }, '0.2.0', 'stable')).toEqual({
      message: 'Shinsa is up to date',
      detail: 'You have Shinsa 0.2.0, the latest version on the Stable channel.',
    });
    expect(describeManualResult({ status: 'current', latest: null }, '0.3.0-beta.1', 'beta')).toEqual({
      message: 'Shinsa is up to date',
      detail: 'You have Shinsa 0.3.0-beta.1, the latest version on the Beta channel.',
    });
    expect(describeManualResult({ status: 'failed', message: 'No network.' }, '0.2.0', 'stable')).toEqual({
      message: 'Shinsa could not check for updates',
      detail: 'No network.',
    });
  });

  it('says a beta stays put on Stable until a stable release passes it', () => {
    expect(describeManualResult({ status: 'current', latest: '1.2.0' }, '1.3.0-beta.2', 'stable')).toEqual({
      message: 'Shinsa is up to date',
      detail:
        'You have Shinsa 1.3.0-beta.2, newer than 1.2.0, the latest on the Stable channel. It stays on 1.3.0-beta.2 until the Stable channel passes it.',
    });
  });

  it('says nothing while an update downloads, since the menu shows it', () => {
    expect(
      describeManualResult({ status: 'downloading', version: '0.3.0', percent: 0 }, '0.2.0', 'stable')
    ).toBeNull();
  });
});

describe('describeUpdateFailure', () => {
  it('keeps only the first line of an error', () => {
    expect(describeUpdateFailure(new Error('HttpError: 404\nat foo'))).toBe('HttpError: 404');
    expect(describeUpdateFailure('offline')).toBe('offline');
  });

  it('falls back to a plain sentence when the error says nothing', () => {
    expect(describeUpdateFailure('')).toBe('The update server did not answer. Try again later.');
  });
});

describe('resolveDesktopUpdate', () => {
  it('tells the page what the updater is doing, without the download’s progress', () => {
    expect(resolveDesktopUpdate({ status: 'downloading', version: '0.3.0', percent: 40 })).toEqual({
      status: 'downloading',
      version: '0.3.0',
    });
    expect(resolveDesktopUpdate({ status: 'ready', version: '0.3.0' })).toEqual({
      status: 'ready',
      version: '0.3.0',
    });
    expect(resolveDesktopUpdate({ status: 'checking', manual: true })).toEqual({ status: 'checking' });
    expect(resolveDesktopUpdate({ status: 'current', latest: '0.2.0' })).toEqual({ status: 'current' });
    expect(resolveDesktopUpdate({ status: 'failed', message: 'offline' })).toEqual({
      status: 'failed',
      message: 'offline',
    });
    expect(resolveDesktopUpdate({ status: 'downgrade', version: '1.2.0' })).toEqual({
      status: 'downgrade',
      version: '1.2.0',
    });
    expect(resolveDesktopUpdate({ status: 'idle' })).toEqual({ status: 'none' });
    expect(resolveDesktopUpdate({ status: 'unavailable' })).toEqual({ status: 'unavailable' });
  });
});

describe('describeDowngradeDialog', () => {
  it('asks to go back to the latest stable release, downloading it by default', () => {
    expect(describeDowngradeDialog('1.2.0', '1.3.0-beta.2')).toEqual({
      message: 'Go back to 1.2.0 (stable)?',
      detail:
        'You have the beta 1.3.0-beta.2, newer than 1.2.0, the latest stable release. Shinsa can download 1.2.0 and install it when you quit, like any update. Or stay on this beta until a stable release passes it.',
      buttons: ['Download and install', 'Stay on this beta'],
      defaultId: DOWNGRADE_ACCEPT,
      cancelId: 1,
    });
  });
});

describe('needsDiscard', () => {
  it('drops a beta that is downloading or downloaded when you switch to Stable', () => {
    expect(needsDiscard({ status: 'ready', version: '1.3.0-beta.3' }, 'stable')).toBe(true);
    expect(needsDiscard({ status: 'downloading', version: '1.3.0-beta.3', percent: 10 }, 'stable')).toBe(
      true
    );
  });

  it('keeps a stable update, any update on Beta, and does nothing without a download', () => {
    expect(needsDiscard({ status: 'ready', version: '1.3.0' }, 'stable')).toBe(false);
    expect(needsDiscard({ status: 'ready', version: '1.3.0-beta.3' }, 'beta')).toBe(false);
    expect(needsDiscard({ status: 'current', latest: '1.2.0' }, 'stable')).toBe(false);
  });
});

describe('resolveStagedUpdate', () => {
  it('names the job and folder where macOS keeps a downloaded update until you quit', () => {
    expect(resolveStagedUpdate('/Users/me', 'studio.overclock.shinsa')).toEqual({
      label: 'studio.overclock.shinsa.ShipIt',
      directory: '/Users/me/Library/Caches/studio.overclock.shinsa.ShipIt',
    });
  });
});
