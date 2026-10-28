import { describe, expect, it } from 'bun:test';
import {
  describeAppVersion,
  describeUpdateChannel,
  isAboveChannel,
  listUpdateChannels,
  parseUpdateChannel,
  resolveDowngradeOffer,
  resolveUpdateChannel,
  resolveUpdaterOptions,
} from '../../src/lib/update-channel.ts';

describe('parseUpdateChannel', () => {
  it('reads Stable and Beta in Shinsa, and only Canary in Shinsa Canary', () => {
    expect(listUpdateChannels()).toEqual(['stable', 'beta']);
    expect(listUpdateChannels('canary')).toEqual(['canary']);
    expect(parseUpdateChannel('stable')).toBe('stable');
    expect(parseUpdateChannel('beta')).toBe('beta');
    expect(parseUpdateChannel('canary')).toBeNull();
    expect(parseUpdateChannel('canary', 'canary')).toBe('canary');
    expect(parseUpdateChannel('beta', 'canary')).toBeNull();
    expect(parseUpdateChannel('latest')).toBeNull();
    expect(parseUpdateChannel(undefined)).toBeNull();
    expect(parseUpdateChannel(1)).toBeNull();
  });
});

describe('resolveUpdateChannel', () => {
  it('keeps the channel you chose', () => {
    expect(resolveUpdateChannel('beta', '1.2.0')).toBe('beta');
    expect(resolveUpdateChannel('stable', '1.3.0-beta.2')).toBe('stable');
  });

  it('starts a beta on Beta and a release on Stable until you choose', () => {
    expect(resolveUpdateChannel(undefined, '1.3.0-beta.2')).toBe('beta');
    expect(resolveUpdateChannel('nightly', '1.2.0')).toBe('stable');
    expect(resolveUpdateChannel(null, '0.0.0')).toBe('stable');
  });

  it('never puts Shinsa on Canary, and keeps Shinsa Canary on it whatever is stored', () => {
    expect(resolveUpdateChannel('canary', '1.3.0')).toBe('stable');
    expect(resolveUpdateChannel(undefined, '1.3.1-canary.4')).toBe('beta');
    expect(resolveUpdateChannel('stable', '1.3.1-canary.4', 'canary')).toBe('canary');
    expect(resolveUpdateChannel(undefined, '1.3.0', 'canary')).toBe('canary');
  });
});

describe('resolveUpdaterOptions', () => {
  it('reads latest-mac.yml from the latest release on Stable', () => {
    expect(resolveUpdaterOptions('stable')).toEqual({
      channel: 'latest',
      allowPrerelease: false,
      allowDowngrade: false,
    });
  });

  it('reads beta-mac.yml from the newest release, pre-releases included, on Beta', () => {
    expect(resolveUpdaterOptions('beta')).toEqual({
      channel: 'beta',
      allowPrerelease: true,
      allowDowngrade: false,
    });
  });

  it('reads canary-mac.yml, pre-releases included, on Canary', () => {
    expect(resolveUpdaterOptions('canary')).toEqual({
      channel: 'canary',
      allowPrerelease: true,
      allowDowngrade: false,
    });
  });
});

describe('resolveUpdaterOptions for going back', () => {
  it('allows a downgrade only for the one Stable or Beta update you accepted', () => {
    expect(resolveUpdaterOptions('stable', true)).toEqual({
      channel: 'latest',
      allowPrerelease: false,
      allowDowngrade: true,
    });
    expect(resolveUpdaterOptions('beta', true).allowDowngrade).toBe(true);
    expect(resolveUpdaterOptions('canary', true).allowDowngrade).toBe(false);
  });
});

describe('isAboveChannel', () => {
  it('is true for a version of a channel ahead of the one chosen', () => {
    expect(isAboveChannel('1.3.0-beta.2', 'stable')).toBe(true);
    expect(isAboveChannel('1.3.1-canary.4', 'beta')).toBe(true);
    expect(isAboveChannel('1.3.1-canary.4', 'canary')).toBe(false);
    expect(isAboveChannel('1.3.0', 'stable')).toBe(false);
    expect(isAboveChannel('1.3.0-beta.2', 'canary')).toBe(false);
  });
});

describe('resolveDowngradeOffer', () => {
  const offer = { channel: 'stable', current: '1.3.0-beta.2', latest: '1.2.0', kept: null } as const;

  it('offers the latest stable release to a beta on Stable that is newer than it', () => {
    expect(resolveDowngradeOffer(offer)).toBe('1.2.0');
  });

  it('offers nothing on Beta, to a stable version, once a stable release passes the beta, or after you stayed', () => {
    expect(resolveDowngradeOffer({ ...offer, channel: 'beta' })).toBeNull();
    expect(resolveDowngradeOffer({ ...offer, current: '1.2.0' })).toBeNull();
    expect(resolveDowngradeOffer({ ...offer, latest: '1.3.0' })).toBeNull();
    expect(resolveDowngradeOffer({ ...offer, kept: '1.3.0-beta.2' })).toBeNull();
    expect(resolveDowngradeOffer({ ...offer, kept: '1.3.0-beta.1' })).toBe('1.2.0');
  });

  it('never offers Shinsa Canary a way back', () => {
    expect(resolveDowngradeOffer({ ...offer, channel: 'canary', current: '1.3.1-canary.4' })).toBeNull();
  });
});

describe('describeUpdateChannel', () => {
  it('names the channel', () => {
    expect(describeUpdateChannel('stable')).toBe('Stable');
    expect(describeUpdateChannel('beta')).toBe('Beta');
    expect(describeUpdateChannel('canary')).toBe('Canary');
    expect(describeAppVersion('1.3.0-beta.2', 'beta')).toBe('1.3.0-beta.2, Beta channel');
  });
});
