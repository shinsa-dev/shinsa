import { describe, expect, test } from 'bun:test';
import { Effect, Option } from 'effect';
import { TestClock } from 'effect/testing';
import { SlackStore } from '../../src/store/slack/service.ts';
import { runTest, TEST_NOW } from '../layers.ts';
import { KAI, LAPTOP, MONA, STUDIO, seedMachine, seedUsers } from './fixtures.ts';

const WORKSPACE = { id: 'T1', name: 'Acme', botUserId: 'B1', sealedBotToken: 'sealed-1' };

const LINK = {
  workspaceId: 'T1',
  slackUserId: 'U1',
  slackUserName: 'mona',
  userId: MONA.id,
  machineId: STUDIO,
  sealedUserToken: 'sealed-user-1',
};

const THREAD = { workspaceId: 'T1', channelId: 'C1', threadTs: '1.000' };

const seedWorkspace = Effect.gen(function* () {
  const slack = yield* SlackStore;
  yield* seedUsers(MONA, KAI);
  yield* seedMachine(STUDIO, MONA.id, 'a');
  yield* seedMachine(LAPTOP, KAI.id, 'b');
  yield* slack.upsertWorkspace(WORKSPACE);
  return slack;
});

describe('Slack workspaces and links', () => {
  test('installing again replaces the bot, and removing the workspace removes its links', async () => {
    const [workspace, link, afterRemove] = await runTest(
      Effect.gen(function* () {
        const slack = yield* seedWorkspace;
        yield* slack.upsertWorkspace({ ...WORKSPACE, botUserId: 'B2', sealedBotToken: 'sealed-2' });
        yield* slack.upsertLink(LINK);
        const readWorkspace = yield* slack.selectWorkspace('T1');
        const readLink = yield* slack.selectLink('T1', 'U1');
        yield* slack.removeWorkspace('T1');
        return [readWorkspace, readLink, yield* slack.selectLink('T1', 'U1')] as const;
      })
    );
    expect(workspace).toEqual(
      Option.some({ ...WORKSPACE, botUserId: 'B2', sealedBotToken: 'sealed-2', installedAt: TEST_NOW })
    );
    expect(link).toEqual(Option.some({ ...LINK, workspaceName: 'Acme', linkedAt: TEST_NOW }));
    expect(Option.isNone(afterRemove)).toBe(true);
  });

  test("linking again moves a Slack user to the new machine, and a machine's links are listed and removed", async () => {
    const [ofStudio, ofLaptop, afterRemove] = await runTest(
      Effect.gen(function* () {
        const slack = yield* seedWorkspace;
        yield* slack.upsertLink(LINK);
        yield* slack.upsertLink({ ...LINK, slackUserId: 'U2', slackUserName: 'kai', userId: KAI.id });
        yield* TestClock.adjust('1 second');
        yield* slack.upsertLink({ ...LINK, machineId: LAPTOP });
        const readOfStudio = yield* slack.listMachineLinks(STUDIO);
        const readOfLaptop = yield* slack.listMachineLinks(LAPTOP);
        yield* slack.removeMachineLinks(STUDIO);
        return [readOfStudio, readOfLaptop, yield* slack.listMachineLinks(STUDIO)] as const;
      })
    );
    expect(ofStudio.map((link) => link.slackUserId)).toEqual(['U2']);
    expect(ofLaptop).toEqual([
      { ...LINK, machineId: LAPTOP, workspaceName: 'Acme', linkedAt: TEST_NOW + 1000 },
    ]);
    expect(afterRemove).toEqual([]);
  });

  test('linking again replaces the sealed user token, and a link may have none', async () => {
    const [replaced, cleared] = await runTest(
      Effect.gen(function* () {
        const slack = yield* seedWorkspace;
        yield* slack.upsertLink(LINK);
        yield* slack.upsertLink({ ...LINK, sealedUserToken: 'sealed-user-2' });
        const readReplaced = yield* slack.selectLink('T1', 'U1');
        yield* slack.upsertLink({ ...LINK, sealedUserToken: null });
        return [readReplaced, yield* slack.selectLink('T1', 'U1')] as const;
      })
    );
    expect(Option.map(replaced, (link) => link.sealedUserToken)).toEqual(Option.some('sealed-user-2'));
    expect(Option.map(cleared, (link) => link.sealedUserToken)).toEqual(Option.some(null));
  });
});

describe('Slack threads, posts and events', () => {
  test('a thread and a post belong to the machine they were recorded for', async () => {
    const results = await runTest(
      Effect.gen(function* () {
        const slack = yield* seedWorkspace;
        yield* slack.recordThread(THREAD, STUDIO);
        yield* slack.recordThread(THREAD, STUDIO);
        yield* slack.recordPost({ workspaceId: 'T1', channelId: 'C1', ts: '2.000' }, STUDIO);
        yield* slack.recordPost({ workspaceId: 'T1', channelId: 'C1', ts: '2.000' }, LAPTOP);
        return [
          yield* slack.hasThread(THREAD, STUDIO),
          yield* slack.hasThread(THREAD, LAPTOP),
          yield* slack.hasPost({ workspaceId: 'T1', channelId: 'C1', ts: '2.000' }, STUDIO),
          yield* slack.hasPost({ workspaceId: 'T1', channelId: 'C1', ts: '2.000' }, LAPTOP),
          yield* slack.selectPoster({ workspaceId: 'T1', channelId: 'C1', ts: '2.000' }),
          yield* slack.selectPoster({ workspaceId: 'T1', channelId: 'C1', ts: '9.000' }),
        ] as const;
      })
    );
    expect(results).toEqual([true, false, true, false, Option.some(STUDIO), Option.none()]);
  });

  test("removing a workspace removes its threads and posts, and not another workspace's", async () => {
    const results = await runTest(
      Effect.gen(function* () {
        const slack = yield* seedWorkspace;
        yield* slack.upsertWorkspace({ ...WORKSPACE, id: 'T2' });
        yield* slack.recordThread(THREAD, STUDIO);
        yield* slack.recordThread({ ...THREAD, workspaceId: 'T2' }, STUDIO);
        yield* slack.recordPost({ workspaceId: 'T1', channelId: 'C1', ts: '2.000' }, STUDIO);
        yield* slack.recordPost({ workspaceId: 'T2', channelId: 'C1', ts: '2.000' }, STUDIO);
        yield* slack.removeWorkspace('T1');
        return [
          yield* slack.hasThread(THREAD, STUDIO),
          yield* slack.hasThread({ ...THREAD, workspaceId: 'T2' }, STUDIO),
          yield* slack.selectPoster({ workspaceId: 'T1', channelId: 'C1', ts: '2.000' }),
          yield* slack.selectPoster({ workspaceId: 'T2', channelId: 'C1', ts: '2.000' }),
        ] as const;
      })
    );
    expect(results).toEqual([false, true, Option.none(), Option.some(STUDIO)]);
  });

  test('an event is new once, and again after a day', async () => {
    const results = await runTest(
      Effect.gen(function* () {
        const slack = yield* SlackStore;
        const first = yield* slack.recordEvent('Ev1');
        const repeat = yield* slack.recordEvent('Ev1');
        yield* TestClock.adjust('1 day');
        return [first, repeat, yield* slack.recordEvent('Ev1')] as const;
      })
    );
    expect(results).toEqual([true, false, true]);
  });
});
