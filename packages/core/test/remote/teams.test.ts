import { describe, expect, test } from 'bun:test';
import { decodeText, encodeText, serializeBase64Url } from '../../src/remote/bytes.ts';
import { createFrameOpener, createFrameSealer } from '../../src/remote/frames.ts';
import { REMOTE_PROTOCOL_VERSION } from '../../src/remote/handshake.ts';
import { serializePublicKey } from '../../src/remote/keys.ts';
import {
  createTeamHello,
  createTeamWelcome,
  deriveTeamSessionKey,
  isTeamKey,
  parseTeamHello,
  parseTeamJoinFragment,
  parseTeamJoinUrl,
  resolveTeamChannelUrl,
  resolveTeamConnectPath,
  resolveTeamJoinUrl,
  serializeTeamJoinFragment,
  type TeamView,
  verifyTeamHello,
  verifyTeamWelcome,
} from '../../src/remote/teams.ts';
import { createKeyPair } from './helpers.ts';

const KEY = serializeBase64Url(new Uint8Array(32).fill(5));

const OTHER_KEY = serializeBase64Url(new Uint8Array(32).fill(6));

const LIST: TeamView = { kind: 'list' };

const TASK: TeamView = { kind: 'task', taskId: 'task-1' };

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
