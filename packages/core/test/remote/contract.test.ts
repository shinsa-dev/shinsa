import { describe, expect, test } from 'bun:test';
import { Option, Result, Schema } from 'effect';
import {
  ClaimCode,
  hasMachineFeature,
  HeartbeatRequest,
  MACHINE_FEATURES,
  InstanceId,
  PairPollResponse,
  PairStartRequest,
  parseEnrollFragment,
  REMOTE_PATHS,
  REMOTE_TEXT_LIMITS,
  RemoteUserId,
  resolveEnrollUrl,
  resolveInstanceConnectPath,
  resolveInstanceLeavePath,
  resolveInstancePath,
  resolveInstanceRemovePath,
  resolvePairApprovePath,
  resolvePairPath,
  resolveRemoteHookUrl,
  resolveTunnelHost,
  TEAM_ACTIONS,
  TEAM_NAME_LIMIT,
  TeamCreateRequest,
  TeamId,
} from '../../src/remote/contract.ts';

describe('the remote contract', () => {
  test('keeps the paths a paired machine already calls', () => {
    expect(REMOTE_PATHS.pairStart).toBe('/__remote/pair/start');
    expect(REMOTE_PATHS.pairPoll).toBe('/__remote/pair/poll');
    expect(REMOTE_PATHS.heartbeat).toBe('/__remote/machine/heartbeat');
    expect(REMOTE_PATHS.offline).toBe('/__remote/machine/offline');
    expect(REMOTE_PATHS.machineRemove).toBe('/__remote/machine/remove');
  });

  test('names an instance tunnel host and its dashboard paths', () => {
    expect(resolveTunnelHost('k3x9')).toBe('t-k3x9.shinsa.dev');
    expect(resolveInstancePath('k3x9')).toBe('/__remote/instances/k3x9');
    expect(resolveInstanceConnectPath('k3x9')).toBe('/__remote/instances/k3x9/connect');
    expect(resolveInstanceRemovePath('k3x9')).toBe('/__remote/instances/k3x9/remove');
    expect(resolveInstanceLeavePath('k3x9')).toBe('/__remote/instances/k3x9/leave');
    expect(resolvePairPath('WXYZ2345')).toBe('/__remote/pairs/WXYZ2345');
    expect(resolvePairApprovePath('WXYZ2345')).toBe('/__remote/pairs/WXYZ2345/approve');
  });

  test('gives a webhook one stable URL on app.shinsa.dev', () => {
    expect(resolveRemoteHookUrl('k3x9', 'schedule-1', 'tok')).toBe(
      'https://app.shinsa.dev/hooks/k3x9/schedule-1/tok'
    );
  });

  test('builds the webhook and enrollment links on another origin, such as a local wrangler dev', () => {
    expect(resolveRemoteHookUrl('k3x9', 's', 't', 'http://127.0.0.1:5183')).toBe(
      'http://127.0.0.1:5183/hooks/k3x9/s/t'
    );
    const fragment = { instanceId: 'k3x9', machineKey: 'key', secret: 'secret', invite: 'tok' };
    expect(resolveEnrollUrl(fragment, 'http://127.0.0.1:5183')).toBe(
      'http://127.0.0.1:5183/enroll#k3x9.key.secret.tok'
    );
  });

  test('runs the dashboard at the root of app.shinsa.dev', () => {
    expect(REMOTE_PATHS.app).toBe('/');
    expect(REMOTE_PATHS.pairPage).toBe('/pair');
    expect(REMOTE_PATHS.enrollPage).toBe('/enroll');
  });

  test('puts the secret, the machine key and the invite token in the fragment, never the path', () => {
    const fragment = { instanceId: 'k3x9', machineKey: 'machine-key', secret: 'secret_1', invite: 'tok_2' };
    const url = resolveEnrollUrl(fragment);
    expect(url).toBe('https://app.shinsa.dev/enroll#k3x9.machine-key.secret_1.tok_2');
    expect(Option.getOrNull(parseEnrollFragment(new URL(url).hash))).toEqual(fragment);
  });

  test('refuses a broken enrollment fragment', () => {
    expect(Option.getOrNull(parseEnrollFragment('#a.b'))).toBeNull();
    expect(Option.getOrNull(parseEnrollFragment('#a.b.c'))).toBeNull();
    expect(Option.getOrNull(parseEnrollFragment('#a..c'))).toBeNull();
    expect(Option.getOrNull(parseEnrollFragment('#a.b.c='))).toBeNull();
    expect(Option.getOrNull(parseEnrollFragment('#a.b.c.d.e'))).toBeNull();
  });
});

describe('the remote contract schemas', () => {
  test('a request keeps every limit the Worker checks', () => {
    const decode = Schema.decodeUnknownOption(PairStartRequest);
    const request = { name: 'Laptop', publicKey: 'k', version: '1.0.0' };
    expect(Option.getOrNull(decode(request))).toEqual(request);
    expect(Option.isNone(decode({ ...request, name: 'x'.repeat(REMOTE_TEXT_LIMITS.machineName + 1) }))).toBe(
      true
    );
    expect(Option.isNone(decode({ ...request, version: '' }))).toBe(true);
    expect(Option.isNone(decode({ name: 'Laptop', publicKey: 'k' }))).toBe(true);
  });

  test('a team name is trimmed, and a blank one is refused with the words the Worker says', () => {
    const decode = Schema.decodeUnknownResult(TeamCreateRequest);
    expect(Result.getOrThrow(decode({ name: '  Platform  ' }))).toEqual({ name: 'Platform' });
    const blank = decode({ name: '   ' });
    expect(Result.isFailure(blank) && blank.failure.message).toContain('Give the team a name.');
    expect(Result.isFailure(decode({ name: 'x'.repeat(TEAM_NAME_LIMIT + 1) }))).toBe(true);
  });

  test('a heartbeat may leave the signing key out, and a poll answer is one of its three states', () => {
    expect(Schema.decodeUnknownSync(HeartbeatRequest)({ localUrl: 'http://127.0.0.1:7446' })).toEqual({
      localUrl: 'http://127.0.0.1:7446',
    });
    const decodeHeartbeat = Schema.decodeUnknownResult(HeartbeatRequest);
    const refusal = (input: unknown) => {
      const result = decodeHeartbeat(input);
      return Result.isFailure(result) ? result.failure.message : null;
    };
    expect(refusal({ localUrl: 'http://10.0.0.2:7446' })).toContain('loopback address');
    expect(refusal({ localUrl: 'not a url' })).toContain('loopback address');
    expect(refusal({ localUrl: 'http://[::1]:7446', signingKey: 'short' })).toContain('P-256 public key');
    expect(refusal({ localUrl: 'http://localhost:7446', signingKey: 'A'.repeat(87) })).toBeNull();
    const decodePoll = Schema.decodeUnknownOption(PairPollResponse);
    expect(Option.isSome(decodePoll({ status: 'pending' }))).toBe(true);
    expect(Option.isNone(decodePoll({ status: 'claimed' }))).toBe(true);
    expect(Option.isNone(decodePoll({ status: 'lost' }))).toBe(true);
  });

  test('a machine names what it speaks, and an older one that names nothing is told apart', () => {
    const features = [...MACHINE_FEATURES];
    const beat = Schema.decodeUnknownSync(HeartbeatRequest)({ localUrl: 'http://127.0.0.1:7446', features });
    expect(hasMachineFeature(beat.features ?? [], 'bound-connect-tokens')).toBe(true);
    expect(hasMachineFeature(beat.features ?? [], 'slack-task-owner')).toBe(true);
    expect(hasMachineFeature([], 'sealed-pairing')).toBe(false);
    const decodeHeartbeat = Schema.decodeUnknownOption(HeartbeatRequest);
    const many = Array.from({ length: 17 }, (_, index) => `feature-${index}`);
    expect(Option.isNone(decodeHeartbeat({ localUrl: 'http://127.0.0.1:7446', features: many }))).toBe(true);
    expect(
      Option.isNone(decodeHeartbeat({ localUrl: 'http://127.0.0.1:7446', features: ['x'.repeat(41)] }))
    ).toBe(true);
    const credentials = {
      instanceId: 'studio000001',
      machineToken: 'machine',
      tunnelToken: 'tunnel',
      tunnelHost: 't-studio000001.shinsa.dev',
      connectKey: 'key',
    };
    const decodePoll = Schema.decodeUnknownSync(PairPollResponse);
    expect(decodePoll({ status: 'claimed', sealedCredentials: 'sealed', owner: 'mona' })).toEqual({
      status: 'claimed',
      sealedCredentials: 'sealed',
      owner: 'mona',
    });
    expect(decodePoll({ status: 'claimed', credentials, owner: 'mona' })).toEqual({
      status: 'claimed',
      credentials,
      owner: 'mona',
    });
  });

  test('an id in a path is one segment, branded so one kind is never passed for another', () => {
    expect(InstanceId.make('a1-b_2')).toBe(InstanceId.make('a1-b_2'));
    for (const id of ['', 'a/b', 'x'.repeat(65), '../x'])
      expect(Option.isNone(Schema.decodeUnknownOption(InstanceId)(id))).toBe(true);
    expect(Option.isNone(Schema.decodeUnknownOption(RemoteUserId)(''))).toBe(true);
    expect(Option.isSome(Schema.decodeUnknownOption(TeamId)('team-1'))).toBe(true);
    expect(Option.isSome(Schema.decodeUnknownOption(ClaimCode)('ABCD1234'))).toBe(true);
    expect(TEAM_ACTIONS).toContain('requests/decline');
  });
});
