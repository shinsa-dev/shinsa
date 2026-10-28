import { describe, expect, it } from 'bun:test';
import {
  DOWNGRADE_ACCEPT,
  describeDowngradeDialog,
  describeInstallError,
  describeInstallFailure,
  describeManualResult,
  describeReadyNotice,
  describeUpdateFailure,
  describeUpdateItem,
  INSTALL_TIMEOUT_MS,
  isUpdateBusy,
  isUpdateSupported,
  needsDiscard,
  resolveDesktopUpdate,
  resolveInstallTimeout,
  resolvePreparedUpdate,
  resolveStagedUpdate,
  UPDATE_CHECK_MS,
} from '../../src/lib/update.ts';

describe('isUpdateSupported', () => {
  it('updates only the packaged Mac app, never a development run', () => {
    expect(isUpdateSupported({ packaged: true, platform: 'darwin' })).toBe(true);
    expect(isUpdateSupported({ packaged: false, platform: 'darwin' })).toBe(false);
    expect(isUpdateSupported({ packaged: true, platform: 'linux' })).toBe(false);
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

  it('shows the update being prepared, and the restart once you clicked it, neither clickable', () => {
    expect(describeUpdateItem({ status: 'preparing', version: '0.3.0' })).toEqual({
      label: 'Preparing Shinsa 0.3.0…',
      enabled: false,
      install: false,
    });
    expect(describeUpdateItem({ status: 'installing', version: '0.3.0' })).toEqual({
      label: 'Restarting to Update…',
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

describe('isUpdateBusy', () => {
  it('holds off checks from the download until the app quits', () => {
    expect(isUpdateBusy({ status: 'downloading', version: '0.3.0', percent: 10 })).toBe(true);
    expect(isUpdateBusy({ status: 'preparing', version: '0.3.0' })).toBe(true);
    expect(isUpdateBusy({ status: 'ready', version: '0.3.0' })).toBe(true);
    expect(isUpdateBusy({ status: 'installing', version: '0.3.0' })).toBe(true);
  });

  it('lets a check run otherwise', () => {
    expect(isUpdateBusy({ status: 'idle' })).toBe(false);
    expect(isUpdateBusy({ status: 'checking', manual: false })).toBe(false);
    expect(isUpdateBusy({ status: 'current', latest: null })).toBe(false);
    expect(isUpdateBusy({ status: 'failed', message: 'offline' })).toBe(false);
    expect(isUpdateBusy({ status: 'downgrade', version: '1.2.0' })).toBe(false);
  });
});

describe('resolvePreparedUpdate', () => {
  it('makes a prepared update ready once macOS has it staged', () => {
    expect(resolvePreparedUpdate({ status: 'preparing', version: '0.3.0' })).toEqual({
      status: 'ready',
      version: '0.3.0',
    });
  });

  it('changes nothing when no update was being prepared, so it notifies once', () => {
    expect(resolvePreparedUpdate({ status: 'ready', version: '0.3.0' })).toBeNull();
    expect(resolvePreparedUpdate({ status: 'idle' })).toBeNull();
    expect(resolvePreparedUpdate({ status: 'downloading', version: '0.3.0', percent: 99 })).toBeNull();
  });
});

describe('resolveInstallTimeout', () => {
  it('offers the restart again when the app is still running after it', () => {
    expect(INSTALL_TIMEOUT_MS).toBe(15_000);
    expect(resolveInstallTimeout({ status: 'installing', version: '0.3.0' })).toEqual({
      status: 'ready',
      version: '0.3.0',
    });
  });

  it('changes nothing once the install already ended another way', () => {
    expect(resolveInstallTimeout({ status: 'failed', message: 'offline' })).toBeNull();
    expect(resolveInstallTimeout({ status: 'ready', version: '0.3.0' })).toBeNull();
  });
});

describe('describeInstallFailure', () => {
  it('says the restart did not happen and how to install anyway', () => {
    expect(describeInstallFailure('0.3.0')).toEqual({
      title: 'Shinsa 0.3.0 did not restart',
      body: 'Quit Shinsa to install it. Agents keep working either way.',
    });
  });
});

describe('describeInstallError', () => {
  it('names the update that failed while it was prepared or installed', () => {
    const notice = { title: 'Shinsa 0.3.0 could not be installed', body: 'Code signature invalid' };
    expect(describeInstallError({ status: 'preparing', version: '0.3.0' }, 'Code signature invalid')).toEqual(
      notice
    );
    expect(
      describeInstallError({ status: 'installing', version: '0.3.0' }, 'Code signature invalid')
    ).toEqual(notice);
  });

  it('leaves a failed check to the menu and the manual answer', () => {
    expect(describeInstallError({ status: 'checking', manual: false }, 'offline')).toBeNull();
    expect(
      describeInstallError({ status: 'downloading', version: '0.3.0', percent: 5 }, 'offline')
    ).toBeNull();
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
    expect(resolveDesktopUpdate({ status: 'preparing', version: '0.3.0' })).toEqual({
      status: 'downloading',
      version: '0.3.0',
    });
    expect(resolveDesktopUpdate({ status: 'installing', version: '0.3.0' })).toEqual({
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
  });
});

describe('describeDowngradeDialog', () => {
  it('asks to go back to the latest stable release, downloading it by default', () => {
    expect(describeDowngradeDialog('1.2.0', '1.3.0-beta.2', 'stable')).toEqual({
      message: 'Go back to 1.2.0 (stable)?',
      detail:
        'You have the beta 1.3.0-beta.2, newer than 1.2.0, the latest on the Stable channel. Shinsa can download 1.2.0 and install it when you quit, like any update. Or stay on this beta until the Stable channel passes it.',
      buttons: ['Download and install', 'Stay on this beta'],
      defaultId: DOWNGRADE_ACCEPT,
      cancelId: 1,
    });
  });

  it('asks a canary on Beta to go back to the latest beta or stable release', () => {
    expect(describeDowngradeDialog('1.3.0-beta.2', '1.3.1-canary.4', 'beta')).toMatchObject({
      message: 'Go back to 1.3.0-beta.2 (beta)?',
      detail:
        'You have the canary 1.3.1-canary.4, newer than 1.3.0-beta.2, the latest on the Beta channel. Shinsa can download 1.3.0-beta.2 and install it when you quit, like any update. Or stay on this canary until the Beta channel passes it.',
      buttons: ['Download and install', 'Stay on this canary'],
    });
    expect(describeDowngradeDialog('1.3.0', '1.3.1-canary.4', 'beta').message).toBe(
      'Go back to 1.3.0 (stable)?'
    );
  });
});

describe('needsDiscard', () => {
  it('drops a beta that is downloading or downloaded when you switch to Stable', () => {
    expect(needsDiscard({ status: 'ready', version: '1.3.0-beta.3' }, 'stable')).toBe(true);
    expect(needsDiscard({ status: 'preparing', version: '1.3.0-beta.3' }, 'stable')).toBe(true);
    expect(needsDiscard({ status: 'downloading', version: '1.3.0-beta.3', percent: 10 }, 'stable')).toBe(
      true
    );
  });

  it('drops a canary that is downloading or downloaded when you switch to Beta or Stable', () => {
    expect(needsDiscard({ status: 'ready', version: '1.3.1-canary.2' }, 'beta')).toBe(true);
    expect(needsDiscard({ status: 'downloading', version: '1.3.1-canary.2', percent: 5 }, 'stable')).toBe(
      true
    );
  });

  it('keeps an update of the chosen channel or a lower one, and does nothing without a download', () => {
    expect(needsDiscard({ status: 'ready', version: '1.3.0' }, 'stable')).toBe(false);
    expect(needsDiscard({ status: 'ready', version: '1.3.0-beta.3' }, 'beta')).toBe(false);
    expect(needsDiscard({ status: 'ready', version: '1.3.0-beta.3' }, 'canary')).toBe(false);
    expect(needsDiscard({ status: 'ready', version: '1.3.1-canary.2' }, 'canary')).toBe(false);
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
