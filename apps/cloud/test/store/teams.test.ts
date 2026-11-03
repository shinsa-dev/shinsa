import { describe, expect, test } from 'bun:test';
import { InstanceId, TeamId } from '@shinsa/core';
import { Effect, Option } from 'effect';
import { TestClock } from 'effect/testing';
import { Teams } from '../../src/store/teams/service.ts';
import { runTest, TEST_NOW } from '../layers.ts';
import { hashOf, KAI, LAPTOP, MONA, RIO, STUDIO, seedMachine, seedUsers } from './fixtures.ts';

const CREW = TeamId.make('crew00000001');

const BAND = TeamId.make('band00000001');

describe('teams', () => {
  test('a team is made at the current time and found by its id; removing it takes its members', async () => {
    const [created, found, members, removed] = await runTest(
      Effect.gen(function* () {
        const teams = yield* Teams;
        yield* seedUsers(MONA, KAI);
        const readCreated = yield* teams.create({ id: CREW, userId: MONA.id, name: 'Crew' });
        const readFound = yield* teams.select(CREW);
        yield* teams.members.add(CREW, KAI.id);
        const readMembers = yield* teams.members.count(CREW);
        yield* teams.remove(CREW);
        return [readCreated, readFound, readMembers, yield* teams.select(CREW)] as const;
      })
    );
    expect(created).toEqual({
      id: CREW,
      userId: MONA.id,
      name: 'Crew',
      permissions: {},
      createdAt: TEST_NOW,
    });
    expect(found).toEqual(Option.some(created));
    expect(members).toBe(1);
    expect(Option.isNone(removed)).toBe(true);
  });

  test("a user's teams are the ones they own or belong to, oldest first, and owned ones are counted", async () => {
    const [ofKai, ofRio, owned] = await runTest(
      Effect.gen(function* () {
        const teams = yield* Teams;
        yield* seedUsers(MONA, KAI, RIO);
        yield* teams.create({ id: CREW, userId: MONA.id, name: 'Crew' });
        yield* TestClock.adjust('1 second');
        yield* teams.create({ id: BAND, userId: KAI.id, name: 'Band' });
        yield* teams.members.add(CREW, KAI.id);
        return [
          yield* teams.listOfUser(KAI.id),
          yield* teams.listOfUser(RIO.id),
          yield* teams.countOwned(KAI.id),
        ] as const;
      })
    );
    expect(ofKai.map((team) => team.id)).toEqual([CREW, BAND]);
    expect(ofRio).toEqual([]);
    expect(owned).toBe(1);
  });

  test('two users share a team when either owns it or both belong to it', async () => {
    const shared = await runTest(
      Effect.gen(function* () {
        const teams = yield* Teams;
        yield* seedUsers(MONA, KAI, RIO);
        yield* teams.create({ id: CREW, userId: MONA.id, name: 'Crew' });
        yield* teams.members.add(CREW, KAI.id);
        return [
          yield* teams.shareTeam(MONA.id, KAI.id),
          yield* teams.shareTeam(KAI.id, MONA.id),
          yield* teams.shareTeam(KAI.id, RIO.id),
        ] as const;
      })
    );
    expect(shared).toEqual([true, true, false]);
  });

  test("a team's machines are its owner's and its members' machines", async () => {
    const machines = await runTest(
      Effect.gen(function* () {
        const teams = yield* Teams;
        yield* seedUsers(MONA, KAI, RIO);
        yield* teams.create({ id: CREW, userId: MONA.id, name: 'Crew' });
        yield* teams.members.add(CREW, KAI.id);
        yield* seedMachine(STUDIO, MONA.id, 'a');
        yield* TestClock.adjust('1 second');
        yield* seedMachine(LAPTOP, KAI.id, 'b');
        yield* seedMachine(InstanceId.make('rio000000001'), RIO.id, 'c');
        return yield* teams.listMachines(CREW);
      })
    );
    expect(machines.map((machine) => machine.id)).toEqual([STUDIO, LAPTOP]);
  });

  test('a team invite and its requesters work like a machine invite and requesters', async () => {
    const [invited, requests] = await runTest(
      Effect.gen(function* () {
        const teams = yield* Teams;
        yield* seedUsers(MONA, KAI);
        yield* teams.create({ id: CREW, userId: MONA.id, name: 'Crew' });
        yield* teams.invites.replace(CREW, hashOf('4'));
        yield* teams.requesters.add(CREW, KAI.id);
        return [yield* teams.invites.select(hashOf('4')), yield* teams.requesters.list(CREW)] as const;
      })
    );
    expect(invited).toEqual(Option.some(CREW));
    expect(requests).toEqual([{ user: KAI, addedAt: TEST_NOW }]);
  });
});
