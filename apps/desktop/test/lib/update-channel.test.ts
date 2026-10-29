import { describe, expect, it } from 'bun:test';
import {
  describeAppVersion,
  describeUpdateChannel,
  isAboveChannel,
  parseUpdateChannel,
  resolveDowngradeOffer,
  resolveUpdateChannel,
  resolveUpdaterOptions,
} from '../../src/lib/update-channel.ts';

describe('parseUpdateChannel', () => {
  it('reads Stable, Beta and Canary', () => {
    expect(parseUpdateChannel('stable')).toBe('stable');
    expect(parseUpdateChannel('beta')).toBe('beta');
    expect(parseUpdateChannel('canary')).toBe('canary');
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

  it('starts a beta on Beta, a canary on Canary and a release on Stable until you choose', () => {
    expect(resolveUpdateChannel(undefined, '1.3.0-beta.2')).toBe('beta');
    expect(resolveUpdateChannel('nightly', '1.2.0')).toBe('stable');
    expect(resolveUpdateChannel(null, '0.0.0')).toBe('stable');
    expect(resolveUpdateChannel(undefined, '1.3.1-canary.4')).toBe('canary');
  });

  it('keeps Canary when you chose it, and leaves it when you choose another channel', () => {
    expect(resolveUpdateChannel('canary', '1.3.0')).toBe('canary');
    expect(resolveUpdateChannel('beta', '1.3.1-canary.4')).toBe('beta');
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
  it('allows a downgrade only for the one Stable or Beta update you accepted, never onto Canary', () => {
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

  it('offers a canary that switched to Beta or Stable the newest version of that channel', () => {
    const canary = { ...offer, current: '1.3.1-canary.4' };
    expect(resolveDowngradeOffer({ ...canary, channel: 'beta', latest: '1.3.0-beta.2' })).toBe(
      '1.3.0-beta.2'
    );
    expect(resolveDowngradeOffer({ ...canary, latest: '1.3.0' })).toBe('1.3.0');
    expect(resolveDowngradeOffer({ ...canary, latest: '1.3.1' })).toBeNull();
  });

  it('never offers a way back on Canary', () => {
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
