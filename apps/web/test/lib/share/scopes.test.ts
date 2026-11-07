import { describe, expect, it } from 'bun:test';
import { SHARE_PRESET_SCOPES } from '@shinsa/core';
import { resolveShareSourceScopes } from '@/lib/share/scopes.ts';

describe('the scopes of a share', () => {
  it('keeps the scopes a share names', () => {
    expect(resolveShareSourceScopes({ scopes: ['identity', 'code'] })).toEqual(['identity', 'code']);
  });

  it('reads an older engine’s preset as its scopes, and anything else as Standard', () => {
    expect(resolveShareSourceScopes({ preset: 'full' })).toEqual(SHARE_PRESET_SCOPES.full);
    expect(resolveShareSourceScopes({ preset: 'other' as never })).toEqual(SHARE_PRESET_SCOPES.standard);
    expect(resolveShareSourceScopes({})).toEqual(SHARE_PRESET_SCOPES.standard);
  });
});
