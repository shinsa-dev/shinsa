import { describe, expect, it } from 'bun:test';
import {
  describeAppDetail,
  describeChannelDetail,
  describeUpdateStatus,
  UPDATE_CHANNEL_ITEMS,
} from '@/lib/updates.ts';

describe('the Updates settings', () => {
  it('offers Stable and Beta', () => {
    expect(UPDATE_CHANNEL_ITEMS.map((item) => item.label)).toEqual(['Stable', 'Beta']);
  });

  it('says what each channel gets, and that leaving a beta can go back to the latest stable', () => {
    expect(describeChannelDetail('stable')).toBe(
      'Releases only. Coming from a beta, you can go back to the latest stable.'
    );
    expect(describeChannelDetail('beta')).toBe(
      'New versions first, as pre-releases, and every stable release once it is newer than yours.'
    );
  });

  it('names the channel under the version', () => {
    expect(describeAppDetail('beta', { status: 'none' })).toBe(
      'Beta channel · Updates install when you quit Shinsa'
    );
    expect(describeAppDetail('stable', { status: 'current' })).toBe(
      'Stable channel · Updates install when you quit Shinsa'
    );
  });

  it('points a build that cannot update to a release', () => {
    expect(describeAppDetail('stable', { status: 'unavailable' })).toBe(
      'Install a release from shinsa.dev/download to get updates'
    );
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
    expect(describeUpdateStatus({ status: 'downloading', version: '1.3.0' })).toEqual({
      label: 'Downloading 1.3.0…',
      tone: 'neutral',
    });
    expect(describeUpdateStatus({ status: 'ready', version: '1.3.0' })).toEqual({
      label: '1.3.0 is ready',
      tone: 'blue',
    });
    expect(describeUpdateStatus({ status: 'downgrade', version: '1.2.0' })).toEqual({
      label: 'Go back to 1.2.0 (stable)?',
      tone: 'blue',
    });
    expect(describeUpdateStatus({ status: 'unavailable' })).toEqual({
      label: 'This build does not update itself',
      tone: 'neutral',
    });
  });
});
