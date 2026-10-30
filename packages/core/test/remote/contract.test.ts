import { describe, expect, test } from 'bun:test';
import {
  parseEnrollFragment,
  parseRemoteHookPath,
  REMOTE_PATHS,
  resolveEnrollUrl,
  resolveInstanceConnectPath,
  resolveInstancePath,
  resolveInstanceRemovePath,
  resolvePairApprovePath,
  resolvePairPath,
  resolveRemoteHookUrl,
  resolveTunnelHost,
} from '../../src/remote/contract.ts';

describe('the remote contract', () => {
  test('keeps the paths a paired machine already calls', () => {
    expect(REMOTE_PATHS.pairStart).toBe('/app/__remote/pair/start');
    expect(REMOTE_PATHS.pairPoll).toBe('/app/__remote/pair/poll');
    expect(REMOTE_PATHS.heartbeat).toBe('/app/__remote/machine/heartbeat');
    expect(REMOTE_PATHS.offline).toBe('/app/__remote/machine/offline');
    expect(REMOTE_PATHS.machineRemove).toBe('/app/__remote/machine/remove');
  });

  test('names an instance tunnel host and its dashboard paths', () => {
    expect(resolveTunnelHost('k3x9')).toBe('t-k3x9.shinsa.dev');
    expect(resolveInstancePath('k3x9')).toBe('/app/__remote/instances/k3x9');
    expect(resolveInstanceConnectPath('k3x9')).toBe('/app/__remote/instances/k3x9/connect');
    expect(resolveInstanceRemovePath('k3x9')).toBe('/app/__remote/instances/k3x9/remove');
    expect(resolvePairPath('WXYZ2345')).toBe('/app/__remote/pairs/WXYZ2345');
    expect(resolvePairApprovePath('WXYZ2345')).toBe('/app/__remote/pairs/WXYZ2345/approve');
  });

  test('gives a webhook one stable URL on shinsa.dev/app and maps it to the engine path', () => {
    const url = resolveRemoteHookUrl('k3x9', 'schedule-1', 'tok');
    expect(url).toBe('https://shinsa.dev/app/hooks/k3x9/schedule-1/tok');
    expect(parseRemoteHookPath(new URL(url).pathname)).toEqual({
      instanceId: 'k3x9',
      enginePath: '/api/hooks/schedule-1/tok',
    });
  });

  test('builds the webhook and enrollment links on another origin, such as a local wrangler dev', () => {
    expect(resolveRemoteHookUrl('k3x9', 's', 't', 'http://127.0.0.1:5183')).toBe(
      'http://127.0.0.1:5183/app/hooks/k3x9/s/t'
    );
    expect(resolveEnrollUrl('k3x9', 'key', 'secret', 'http://127.0.0.1:5183')).toBe(
      'http://127.0.0.1:5183/app/enroll#k3x9.key.secret'
    );
  });

  test('keeps the dashboard under one path of shinsa.dev', () => {
    expect(REMOTE_PATHS.app).toBe('/app/');
    expect(REMOTE_PATHS.pairPage).toBe('/app/pair');
    expect(REMOTE_PATHS.enrollPage).toBe('/app/enroll');
    expect(Object.values(REMOTE_PATHS).every((path) => path.startsWith('/app/'))).toBe(true);
  });

  test('refuses a hook path of another shape', () => {
    expect(parseRemoteHookPath('/api/hooks/a/b')).toBeNull();
    expect(parseRemoteHookPath('/app/hooks/a/b')).toBeNull();
    expect(parseRemoteHookPath('/app/hooks/a//c')).toBeNull();
    expect(parseRemoteHookPath('/app/hooks/a/b/c/d')).toBeNull();
  });

  test('puts the enrollment secret and machine key in the fragment, never the path', () => {
    const url = resolveEnrollUrl('k3x9', 'machine-key', 'secret_1');
    expect(url).toBe('https://shinsa.dev/app/enroll#k3x9.machine-key.secret_1');
    expect(parseEnrollFragment(new URL(url).hash)).toEqual({
      instanceId: 'k3x9',
      machineKey: 'machine-key',
      secret: 'secret_1',
    });
  });

  test('refuses a broken enrollment fragment', () => {
    expect(parseEnrollFragment('#a.b')).toBeNull();
    expect(parseEnrollFragment('#a..c')).toBeNull();
    expect(parseEnrollFragment('#a.b.c=')).toBeNull();
  });
});
