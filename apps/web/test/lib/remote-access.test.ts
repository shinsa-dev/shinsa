import { describe, expect, it } from 'bun:test';
import {
  canEnrollDevices,
  describeAcceptOutcome,
  describeAccessRequest,
  describeDeviceDetail,
  describeDeviceSeen,
  describeMemberSince,
  describeRemoteStatus,
  LINK_COPY,
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
      detail: 'Signed in as mona. Resume to reach this machine again.',
    });
    expect(describeRemoteStatus(createRemoteSnapshot({ status: 'revoked' }), NOW)).toMatchObject({
      label: 'Removed',
      tone: 'red',
    });
    expect(describeRemoteStatus(createRemoteSnapshot(), NOW)).toEqual({
      label: 'Connected',
      tone: 'green',
      detail: 'Signed in as mona. Open it in Shinsa Cloud.',
    });
    expect(describeRemoteStatus(createRemoteSnapshot({ owner: null, status: 'starting' }), NOW)).toEqual({
      label: 'Connecting',
      tone: 'amber',
      detail: 'Signed in. Open it in Shinsa Cloud.',
    });
    expect(describeRemoteStatus(createRemoteSnapshot({ status: 'off' }), NOW).label).toBe('Not connected');
  });

  it('says when a device was added or last used', () => {
    const device = {
      publicKey: 'k',
      name: 'iPhone',
      enrolledAt: NOW - 3_600_000,
      lastSeenAt: null,
      userId: null,
    };
    expect(describeDeviceSeen(device, NOW)).toStartWith('Added ');
    expect(describeDeviceSeen({ ...device, lastSeenAt: NOW - 60_000 }, NOW)).toStartWith('Last used ');
  });

  it('says what the one link does', () => {
    expect(LINK_COPY.intro).toContain('your own devices and for other people');
    expect(LINK_COPY.share).toContain('The link works until you turn it off.');
  });

  it('says what each request asks for, and what accepting does, in a few words', () => {
    const kai = { id: '7', login: 'kai', name: 'Kai Lane', avatarUrl: null };
    const mona = { id: '1', login: 'mona', name: null, avatarUrl: null };
    const request = {
      id: 'r1',
      publicKey: 'k',
      deviceName: 'Kai iPhone',
      user: kai,
      requestedAt: NOW - 60_000,
    };
    expect(describeAccessRequest(request, NOW)).toMatch(/^Kai iPhone · Asked /);
    const access = { owner: mona, members: [] };
    expect(describeAcceptOutcome(request, access)).toBe('Kai joined.');
    const member = { ...access, members: [{ user: kai, addedAt: 0 }] };
    expect(describeAcceptOutcome(request, member)).toBe('Kai iPhone is added.');
    expect(describeAcceptOutcome({ ...request, user: mona }, access)).toBe('Kai iPhone is added.');
    expect(describeAcceptOutcome(request, null)).toBe('Kai iPhone is added.');
  });

  it('says which member added a device and when a member joined', () => {
    const kai = { id: '7', login: 'kai', name: null, avatarUrl: null };
    const access = {
      owner: { ...kai, id: '1', login: 'mona' },
      members: [{ user: kai, addedAt: NOW - 60_000 }],
    };
    const device = {
      publicKey: 'k',
      name: 'Phone',
      enrolledAt: NOW - 3_600_000,
      lastSeenAt: null,
      userId: '7',
    };
    expect(describeDeviceDetail(device, access, NOW)).toMatch(/^Added .* · Added by kai$/);
    expect(describeDeviceDetail({ ...device, userId: null }, access, NOW)).not.toContain('Added by');
    expect(describeMemberSince(access.members[0] ?? { user: kai, addedAt: 0 }, NOW)).toStartWith('Joined ');
  });

  it('takes a new device only while paired, on and not removed at app.shinsa.dev', () => {
    expect(canEnrollDevices(null)).toBe(false);
    expect(canEnrollDevices(createRemoteSnapshot())).toBe(true);
    expect(canEnrollDevices(createRemoteSnapshot({ status: 'reconnecting' }))).toBe(true);
    expect(canEnrollDevices(createRemoteSnapshot({ enabled: false }))).toBe(false);
    expect(canEnrollDevices(createRemoteSnapshot({ paired: false }))).toBe(false);
    expect(canEnrollDevices(createRemoteSnapshot({ status: 'revoked' }))).toBe(false);
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
