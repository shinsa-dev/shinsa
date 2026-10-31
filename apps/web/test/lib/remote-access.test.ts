import { describe, expect, it } from 'bun:test';
import {
  canEnrollDevices,
  describeAcceptOutcome,
  describeAccessRequest,
  describeDeviceDetail,
  describeDeviceSeen,
  describeLinkAge,
  describeMemberSince,
  describeRemoteStatus,
  LINK_COPY,
  resolveQrImage,
  selectLink,
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

  it('finds each kind of link and says how old it is', () => {
    const link = { kind: 'invite' as const, url: 'u', createdAt: NOW - 3_600_000 };
    const snapshot = createRemoteSnapshot({ links: [link] });
    expect(selectLink(snapshot, 'invite')).toBe(link);
    expect(selectLink(snapshot, 'device')).toBeNull();
    expect(selectLink(null, 'device')).toBeNull();
    expect(describeLinkAge(link, NOW)).toMatch(/^Made .*\. It works until you turn it off\.$/);
    expect(LINK_COPY.device.intro).toContain('your own devices');
    expect(LINK_COPY.invite.share).toContain('nothing opens until you accept');
  });

  it('says who asks for what, and what accepting does', () => {
    const kai = { id: '7', login: 'kai', name: 'Kai Lane', avatarUrl: null };
    const mona = { id: '1', login: 'mona', name: null, avatarUrl: null };
    const request = {
      id: 'r1',
      kind: 'invite' as const,
      publicKey: 'k',
      deviceName: 'Kai iPhone',
      user: kai,
      requestedAt: NOW - 60_000,
    };
    expect(describeAccessRequest(request, NOW)).toMatch(/^Kai iPhone · Invite · Asked /);
    expect(describeAccessRequest({ ...request, kind: 'device' }, NOW)).toContain(' · Add device · ');
    const access = { owner: mona, members: [] };
    expect(describeAcceptOutcome(request, access)).toBe(
      '@kai joins this machine with full control, and Kai iPhone is added.'
    );
    const member = { ...access, members: [{ user: kai, addedAt: 0 }] };
    expect(describeAcceptOutcome(request, member)).toBe('Kai iPhone is added for @kai.');
    expect(describeAcceptOutcome({ ...request, user: mona }, access)).toBe('Kai iPhone is added for @mona.');
    expect(describeAcceptOutcome({ ...request, kind: 'device' }, access)).toBe(
      'Kai iPhone is added for @kai.'
    );
    expect(describeAcceptOutcome(request, null)).toBe('Kai iPhone is added for @kai.');
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
    expect(describeDeviceDetail(device, access, NOW)).toMatch(/^Added .* · Added by @kai$/);
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
