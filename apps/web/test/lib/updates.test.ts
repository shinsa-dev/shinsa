import { describe, expect, it } from 'bun:test';
import {
  describeAppDetail,
  describeChannelDetail,
  describeStayLabel,
  describeUpdateStatus,
  parseUpdateChannel,
  UPDATE_CHANNEL_ITEMS,
} from '@/lib/updates.ts';

describe('the Updates settings', () => {
  it('offers Stable, Beta and Canary', () => {
    expect(UPDATE_CHANNEL_ITEMS.map((item) => item.label)).toEqual(['Stable', 'Beta', 'Canary']);
  });

  it('reads a channel from a menu value, Stable for anything else', () => {
    expect(parseUpdateChannel('beta')).toBe('beta');
    expect(parseUpdateChannel('canary')).toBe('canary');
    expect(parseUpdateChannel('nightly')).toBe('stable');
  });

  it('says what each channel gets, and that leaving a beta or a canary can go back to the latest stable', () => {
    expect(describeChannelDetail('stable')).toBe(
      'Releases only. Coming from a beta or a canary, you can go back to the latest stable.'
    );
    expect(describeChannelDetail('beta')).toBe(
      'New versions first, as pre-releases, and every stable release once it is newer than yours.'
    );
    expect(describeChannelDetail('canary')).toBe(
      'Every merge into main once its tests pass. Less tested than Beta.'
    );
  });

  it('names the version you would stay on', () => {
    expect(describeStayLabel('1.3.0-beta.2')).toBe('Stay on this beta');
  });

  it('names the channel under the version', () => {
    expect(describeAppDetail('beta')).toBe('Beta channel · Updates install when you quit Shinsa');
    expect(describeAppDetail('stable')).toBe('Stable channel · Updates install when you quit Shinsa');
    expect(describeAppDetail('canary')).toBe('Canary channel · Updates install when you quit Shinsa');
  });

  it('says what the updater is doing, and nothing before its first check', () => {
    expect(describeUpdateStatus({ status: 'none' })).toBeNull();
    expect(describeUpdateStatus({ status: 'checking' })).toEqual({
      label: 'Checking for updates…',
      tone: 'neutral',
    });
    expect(describeUpdateStatus({ status: 'current' })).toEqual({ label: 'Up to date', tone: 'neutral' });
    expect(describeUpdateStatus({ status: 'failed', message: 'offline' })).toEqual({
      label: 'offline',
      tone: 'orange',
    });
    expect(describeUpdateStatus({ status: 'downloading', version: '1.3.0', percent: 42 })).toEqual({
      label: 'Downloading 1.3.0… 42%',
      tone: 'neutral',
    });
    expect(describeUpdateStatus({ status: 'preparing', version: '1.3.0' })).toEqual({
      label: 'Preparing 1.3.0…',
      tone: 'neutral',
    });
    expect(describeUpdateStatus({ status: 'ready', version: '1.3.0' })).toEqual({
      label: '1.3.0 is ready',
      tone: 'blue',
    });
    expect(describeUpdateStatus({ status: 'installing', version: '1.3.0' })).toEqual({
      label: 'Restarting to install 1.3.0…',
      tone: 'neutral',
    });
    expect(describeUpdateStatus({ status: 'downgrade', version: '1.2.0' })).toEqual({
      label: 'Go back to 1.2.0 (stable)?',
      tone: 'blue',
    });
  });
});
