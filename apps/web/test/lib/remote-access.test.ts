import { describe, expect, it } from 'bun:test';
import {
  describeDeviceSeen,
  describeEnrollmentExpiry,
  describeRemoteStatus,
  isRemoteSettling,
  resolveQrImage,
} from '@/lib/remote-access.ts';
import { createRemoteSnapshot } from '../support/remote-access.ts';

const NOW = 1_800_000_000_000;

describe('remote access words', () => {
  it('says what to do when it is off, pairing, paused, removed or connected', () => {
    const off = describeRemoteStatus(
      createRemoteSnapshot({ paired: false, status: 'off', owner: null }),
      NOW
    );
    expect(off).toMatchObject({ label: 'Off', tone: 'neutral' });
    expect(off.detail).toContain('sign in with GitHub');
    const pairing = describeRemoteStatus(
      createRemoteSnapshot({
        paired: false,
        pairing: {
          claimCode: 'K7PQ',
          url: 'https://app.shinsa.dev/pair?code=K7PQ',
          expiresAt: NOW + 600_000,
        },
      }),
      NOW
    );
    expect(pairing).toMatchObject({ label: 'Waiting for sign-in', tone: 'amber' });
    expect(pairing.detail).toContain('K7PQ');
    expect(describeRemoteStatus(createRemoteSnapshot({ enabled: false }), NOW)).toMatchObject({
      label: 'Paused',
      detail: 'Signed in as mona. Resume to reach this Mac again.',
    });
    expect(describeRemoteStatus(createRemoteSnapshot({ status: 'revoked' }), NOW)).toMatchObject({
      label: 'Removed',
      tone: 'red',
    });
    expect(describeRemoteStatus(createRemoteSnapshot(), NOW)).toEqual({
      label: 'Connected',
      tone: 'green',
      detail: 'Signed in as mona. Open it at app.shinsa.dev.',
    });
    expect(describeRemoteStatus(createRemoteSnapshot({ owner: null, status: 'starting' }), NOW)).toEqual({
      label: 'Connecting',
      tone: 'amber',
      detail: 'Signed in. Open it at app.shinsa.dev.',
    });
  });

  it('keeps reading while pairing or while the tunnel comes up, and stops once it settles', () => {
    expect(isRemoteSettling(null)).toBe(false);
    expect(
      isRemoteSettling(createRemoteSnapshot({ pairing: { claimCode: 'K7PQ', url: 'u', expiresAt: 1 } }))
    ).toBe(true);
    expect(isRemoteSettling(createRemoteSnapshot({ status: 'starting' }))).toBe(true);
    expect(isRemoteSettling(createRemoteSnapshot({ status: 'reconnecting' }))).toBe(true);
    expect(isRemoteSettling(createRemoteSnapshot({ status: 'reconnecting', enabled: false }))).toBe(false);
    expect(isRemoteSettling(createRemoteSnapshot())).toBe(false);
  });

  it('says when a device was added or last used, and when a link stops working', () => {
    const device = { publicKey: 'k', name: 'iPhone', enrolledAt: NOW - 3_600_000, lastSeenAt: null };
    expect(describeDeviceSeen(device, NOW)).toStartWith('Added ');
    expect(describeDeviceSeen({ ...device, lastSeenAt: NOW - 60_000 }, NOW)).toStartWith('Last used ');
    expect(describeEnrollmentExpiry(NOW + 600_000, NOW)).toStartWith('It works once and expires');
    expect(describeEnrollmentExpiry(NOW, NOW)).toBe('This link expired. Make a new one.');
  });

  it('draws the link as a square QR code on white, one black cell per dark module', () => {
    const image = decodeURIComponent(
      resolveQrImage('https://app.shinsa.dev/enroll#k3x9.key.secret').replace(
        'data:image/svg+xml;charset=utf-8,',
        ''
      )
    );
    const size = Number(/viewBox="-4 -4 (\d+) /.exec(image)?.[1]) - 8;
    expect(size).toBeGreaterThanOrEqual(21);
    expect(image).toContain('fill="#fff"');
    expect(image).toMatch(/<path d="M0 0h1v1h-1z(M\d+ \d+h1v1h-1z)+" fill="#000"\/>/);
  });
});
