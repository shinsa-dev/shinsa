import { describe, expect, it } from 'bun:test';
import {
  clearEnrollFragment,
  isRemoteBuild,
  resolveMachineLabel,
  resolveOnMachineUrl,
  resolveRemoteView,
  SERVICE_WORKER_PATH,
  SERVICE_WORKER_SCOPE,
  selectEnrollFragment,
  stashEnrollFragment,
} from '@/lib/remote/mode.ts';

const FRAGMENT = '#k3x9.machine-key.secret_1';

describe('the remote page’s mode', () => {
  it('calls the machine this device runs on This machine, and marks a link opened on it', () => {
    expect(resolveMachineLabel({ name: 'Studio', current: true })).toBe('This machine');
    expect(resolveMachineLabel({ name: 'Studio' })).toBe('Studio');
    expect(resolveOnMachineUrl('https://app.shinsa.dev/enroll#a.b.c')).toBe(
      'https://app.shinsa.dev/enroll?on=machine#a.b.c'
    );
    expect(resolveOnMachineUrl('https://app.shinsa.dev/enroll?x=1')).toBe(
      'https://app.shinsa.dev/enroll?x=1&on=machine'
    );
  });

  it('is on only in the remote build', () => {
    expect(isRemoteBuild({ VITE_SHINSA_REMOTE: '1' })).toBe(true);
    expect(isRemoteBuild({})).toBe(false);
    expect(isRemoteBuild()).toBe(false);
  });

  it('shows the pair page, the enroll page, or the one dashboard of every machine, all at the root', () => {
    expect(resolveRemoteView({ pathname: '/pair', search: '?code=K7PQ', hash: '' })).toEqual({
      kind: 'pair',
      claimCode: 'K7PQ',
    });
    expect(resolveRemoteView({ pathname: '/pair', search: '', hash: '' })).toEqual({
      kind: 'pair',
      claimCode: null,
    });
    expect(resolveRemoteView({ pathname: '/enroll', search: '', hash: '' })).toEqual({ kind: 'enroll' });
    expect(resolveRemoteView({ pathname: '/tasks/LOC-1', search: '', hash: '' })).toEqual({ kind: 'app' });
    expect(resolveRemoteView({ pathname: '/', search: '', hash: '' })).toEqual({ kind: 'app' });
    const shareId = 'BwcHBwcHBwcHBwcHBwcHBw';
    const key = 'CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk';
    expect(resolveRemoteView({ pathname: `/share/k3x9/${shareId}`, search: '', hash: `#${key}` })).toEqual({
      kind: 'share',
      link: { instanceId: 'k3x9', shareId, key },
    });
    expect(resolveRemoteView({ pathname: `/share/k3x9/${shareId}`, search: '', hash: '' })).toEqual({
      kind: 'share',
      link: null,
    });
    expect(SERVICE_WORKER_PATH).toBe('/sw.js');
    expect(SERVICE_WORKER_SCOPE).toBe('/');
  });

  it('keeps an enrollment link through the GitHub sign-in, and only a valid one', () => {
    sessionStorage.clear();
    stashEnrollFragment(sessionStorage, '#broken');
    expect(selectEnrollFragment(sessionStorage, '')).toBeNull();
    stashEnrollFragment(sessionStorage, FRAGMENT);
    const expected = { instanceId: 'k3x9', machineKey: 'machine-key', secret: 'secret_1', onMachine: false };
    expect(selectEnrollFragment(sessionStorage, '')).toEqual(expected);
    expect(selectEnrollFragment(sessionStorage, '#a.b.c')).toEqual({
      instanceId: 'a',
      machineKey: 'b',
      secret: 'c',
      onMachine: false,
    });
    stashEnrollFragment(sessionStorage, FRAGMENT, '?on=machine');
    expect(selectEnrollFragment(sessionStorage, '')?.onMachine).toBe(true);
    clearEnrollFragment(sessionStorage);
    expect(selectEnrollFragment(sessionStorage, '')).toBeNull();
  });
});
