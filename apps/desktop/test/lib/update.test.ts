import { describe, expect, it } from 'bun:test';
import {
  describeManualResult,
  describeReadyNotice,
  describeUpdateFailure,
  describeUpdateItem,
  isUpdateSupported,
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
    expect(describeUpdateItem({ status: 'current' })).toEqual(check);
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
  it('answers a check you asked for when there is nothing new or it failed', () => {
    expect(describeManualResult({ status: 'current' }, '0.2.0')).toEqual({
      message: 'Shinsa is up to date',
      detail: 'You have Shinsa 0.2.0, the latest version.',
    });
    expect(describeManualResult({ status: 'failed', message: 'No network.' }, '0.2.0')).toEqual({
      message: 'Shinsa could not check for updates',
      detail: 'No network.',
    });
  });

  it('says nothing while an update downloads, since the menu shows it', () => {
    expect(describeManualResult({ status: 'downloading', version: '0.3.0', percent: 0 }, '0.2.0')).toBeNull();
  });
});

describe('describeUpdateFailure', () => {
  it('keeps only the first line of an error', () => {
    expect(describeUpdateFailure(new Error('HttpError: 404\nat foo'))).toBe('HttpError: 404');
    expect(describeUpdateFailure('offline')).toBe('offline');
  });

  it('falls back to a plain sentence when the error says nothing', () => {
    expect(describeUpdateFailure(new Error(''))).toBe('The update server did not answer. Try again later.');
  });
});
