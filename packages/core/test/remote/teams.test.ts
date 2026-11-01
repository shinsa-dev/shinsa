import { describe, expect, test } from 'bun:test';
import { decodeText, encodeText, serializeBase64Url } from '../../src/remote/bytes.ts';
import { createFrameOpener, createFrameSealer } from '../../src/remote/frames.ts';
import { REMOTE_PROTOCOL_VERSION } from '../../src/remote/handshake.ts';
import { SIGNING_KEY_ALGORITHM, serializePublicKey } from '../../src/remote/keys.ts';
import {
  createTeamHello,
  createTeamWelcome,
  deriveTeamSessionKey,
  isTeamKey,
  isTeamSnapshotExpired,
  parseTeamHello,
  parseTeamJoinFragment,
  parseTeamJoinUrl,
  parseTeamViewTarget,
  readTeamSnapshot,
  resolveMachineTeamPath,
  resolveTeamChannelUrl,
  resolveTeamConnectPath,
  resolveTeamJoinUrl,
  resolveTeamLeavePath,
  resolveTeamViewPath,
  selectTeamSnapshotSigner,
  serializeTeamJoinFragment,
  signTeamSnapshot,
  TEAM_SNAPSHOT_TTL_MS,
  type TeamSnapshotBody,
  type TeamView,
  verifyTeamHello,
  verifyTeamSnapshot,
  verifyTeamWelcome,
} from '../../src/remote/teams.ts';
import { createKeyPair } from './helpers.ts';

const KEY = serializeBase64Url(new Uint8Array(32).fill(5));

const OTHER_KEY = serializeBase64Url(new Uint8Array(32).fill(6));

const LIST: TeamView = { kind: 'list' };

const TASK: TeamView = { kind: 'task', taskId: 'task-1' };

describe('the local view of a teammate’s task', () => {
  test('names the team, the machine and the task, and reads them back', () => {
    const target = { teamId: 'team-1', instanceId: 'inst_2', taskId: '01a1-task' };
    const path = resolveTeamViewPath(target);
    expect(path).toBe('/api/teams/view?team=team-1&machine=inst_2&task=01a1-task');
    expect(parseTeamViewTarget(new URL(path, 'http://localhost'))).toEqual(target);
  });

  test('refuses a view with a part missing or out of shape', () => {
    expect(parseTeamViewTarget(new URL('http://localhost/api/teams/view?team=t&machine=m'))).toBeNull();
    expect(
      parseTeamViewTarget(new URL('http://localhost/api/teams/view?team=t&machine=m&task=a%2Fb'))
    ).toBeNull();
  });
});

describe('the team join link', () => {
  test('carries the team, the invite and the key in its fragment, and reads back', () => {
    const fragment = { teamId: 'team-1', invite: 'invite_1', key: KEY };
    const url = resolveTeamJoinUrl(fragment, 'https://app.example');
    expect(url).toBe(`https://app.example/share/team#team-1.invite_1.${KEY}`);
    expect(parseTeamJoinUrl(url)).toEqual(fragment);
    expect(parseTeamJoinUrl(` ${url} `)).toEqual(fragment);
    expect(parseTeamJoinFragment(`#${serializeTeamJoinFragment(fragment)}`)).toEqual(fragment);
    expect(resolveTeamJoinUrl(fragment)).toStartWith('https://app.shinsa.dev/share/team#');
  });

  test('refuses a link of another page, a broken fragment or a key of the wrong size', () => {
    expect(parseTeamJoinUrl(`https://app.example/share/t#team-1.invite.${KEY}`)).toBeNull();
    expect(parseTeamJoinUrl('not a url')).toBeNull();
    expect(parseTeamJoinFragment('team-1.invite')).toBeNull();
    expect(parseTeamJoinFragment(`team 1.invite.${KEY}`)).toBeNull();
    expect(parseTeamJoinFragment('team-1.invite.AAAA')).toBeNull();
    expect(isTeamKey(KEY)).toBe(true);
    expect(isTeamKey('!')).toBe(false);
  });

  test('names the team routes and the tunnel channel', () => {
    expect(resolveTeamConnectPath('team 1')).toBe('/__remote/teams/team%201/connect');
    expect(resolveTeamLeavePath('t1')).toBe('/__remote/teams/t1/leave');
    expect(resolveMachineTeamPath('t1', 'members/add')).toBe('/__remote/machine/teams/t1/members/add');
    expect(resolveTeamChannelUrl('https://t-i.shinsa.dev', 'a.b')).toBe(
      'https://t-i.shinsa.dev/team?token=a.b'
    );
  });
});

describe('the team handshake', () => {
  test('both sides derive one key for the view asked for, and only with the team key', async () => {
    const client = await createKeyPair();
    const server = await createKeyPair();
    const hello = await createTeamHello('team-1', KEY, TASK, client.publicKey);
    expect(parseTeamHello(JSON.stringify(hello))).toEqual(hello);
    expect(await verifyTeamHello(KEY, hello)).toBe(true);
    expect(await verifyTeamHello(OTHER_KEY, hello)).toBe(false);
    expect(await verifyTeamHello(KEY, { ...hello, team: 'team-2' })).toBe(false);
    expect(await verifyTeamHello(KEY, { ...hello, view: LIST })).toBe(false);
    expect(await verifyTeamHello(KEY, { ...hello, view: { kind: 'task', taskId: 'task-2' } })).toBe(false);
    const keys = {
      team: 'team-1',
      view: TASK,
      clientEphemeral: hello.ephemeral,
      serverEphemeral: await serializePublicKey(server.publicKey),
    };
    const welcome = await createTeamWelcome(KEY, keys);
    expect(await verifyTeamWelcome(KEY, keys, welcome.proof)).toBe(true);
    expect(await verifyTeamWelcome(OTHER_KEY, keys, welcome.proof)).toBe(false);
    expect(await verifyTeamWelcome(KEY, { ...keys, view: LIST }, welcome.proof)).toBe(false);
    const sending = await deriveTeamSessionKey(KEY, keys, server.privateKey, keys.clientEphemeral);
    const receiving = await deriveTeamSessionKey(KEY, keys, client.privateKey, keys.serverEphemeral);
    const listing = await deriveTeamSessionKey(
      KEY,
      { ...keys, view: LIST },
      client.privateKey,
      keys.serverEphemeral
    );
    const frame = await createFrameSealer(sending)(encodeText('live'));
    expect(decodeText(await createFrameOpener(receiving)(frame))).toBe('live');
    await expect(createFrameOpener(listing)(frame)).rejects.toThrow('A frame failed to open.');
  });

  test('refuses hellos of the wrong shape or view', async () => {
    const client = await createKeyPair();
    const hello = await createTeamHello('team-1', KEY, LIST, client.publicKey);
    expect(parseTeamHello(JSON.stringify(hello))?.view).toEqual(LIST);
    expect(parseTeamHello('{')).toBeNull();
    expect(parseTeamHello(JSON.stringify({ ...hello, type: 'share-hello' }))).toBeNull();
    expect(parseTeamHello(JSON.stringify({ ...hello, version: REMOTE_PROTOCOL_VERSION + 1 }))).toBeNull();
    expect(parseTeamHello(JSON.stringify({ ...hello, view: null }))).toBeNull();
    expect(parseTeamHello(JSON.stringify({ ...hello, view: { kind: 'chat' } }))).toBeNull();
    expect(parseTeamHello(JSON.stringify({ ...hello, view: { kind: 'task', taskId: '../x' } }))).toBeNull();
    expect(parseTeamHello(JSON.stringify({ ...hello, team: 1 }))).toBeNull();
    await expect(createTeamHello('team-1', '', LIST, client.publicKey)).rejects.toThrow(
      'The channel key is not valid.'
    );
  });
});

describe('a signed team snapshot', () => {
  const BODY: TeamSnapshotBody = { teamId: 'team-1', instanceId: 'studio', tasks: [], updatedAt: 1_000 };

  async function createSigner() {
    const pair = (await crypto.subtle.generateKey(SIGNING_KEY_ALGORITHM, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    return { privateKey: pair.privateKey, signingKey: await serializePublicKey(pair.publicKey) };
  }

  test('verifies with the machine’s own key and gives back what it signed', async () => {
    const signer = await createSigner();
    const snapshot = await signTeamSnapshot(signer.privateKey, BODY);
    expect(await verifyTeamSnapshot(signer.signingKey, snapshot)).toEqual(BODY);
    expect(readTeamSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
  });

  test('refuses another machine’s key, a changed body, a bad signature or a bad key', async () => {
    const signer = await createSigner();
    const other = await createSigner();
    const snapshot = await signTeamSnapshot(signer.privateKey, BODY);
    expect(await verifyTeamSnapshot(other.signingKey, snapshot)).toBeNull();
    const forged = { ...snapshot, body: JSON.stringify({ ...BODY, instanceId: 'laptop' }) };
    expect(await verifyTeamSnapshot(signer.signingKey, forged)).toBeNull();
    expect(await verifyTeamSnapshot(signer.signingKey, { ...snapshot, signature: '!' })).toBeNull();
    expect(await verifyTeamSnapshot('nope', snapshot)).toBeNull();
  });

  test('refuses a signed body that is not a snapshot', async () => {
    const signer = await createSigner();
    for (const body of [{ ...BODY, tasks: 'none' }, { ...BODY, updatedAt: 'now' }, []]) {
      const snapshot = await signTeamSnapshot(signer.privateKey, body as unknown as TeamSnapshotBody);
      expect(await verifyTeamSnapshot(signer.signingKey, snapshot)).toBeNull();
    }
  });

  test('names the machine a snapshot says signed it, before it is verified', async () => {
    const signer = await createSigner();
    expect(selectTeamSnapshotSigner(await signTeamSnapshot(signer.privateKey, BODY))).toBe(BODY.instanceId);
    expect(selectTeamSnapshotSigner({ body: '{"instanceId":3}', signature: 'x' })).toBeNull();
    expect(selectTeamSnapshotSigner({ body: 'not json', signature: 'x' })).toBeNull();
  });

  test('expires 30 days after the machine last updated it', () => {
    expect(isTeamSnapshotExpired(0, TEAM_SNAPSHOT_TTL_MS)).toBe(false);
    expect(isTeamSnapshotExpired(0, TEAM_SNAPSHOT_TTL_MS + 1)).toBe(true);
  });

  test('reads a snapshot only with a text body and signature', () => {
    expect(readTeamSnapshot(null)).toBeNull();
    expect(readTeamSnapshot({ body: 1, signature: 'x' })).toBeNull();
    expect(readTeamSnapshot({ body: '{}', signature: 'x' })).toEqual({ body: '{}', signature: 'x' });
  });
});
