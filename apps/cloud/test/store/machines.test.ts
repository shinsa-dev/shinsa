import { describe, expect, test } from 'bun:test';
import { MACHINE_FEATURES, TeamId } from '@shinsa/core';
import { Effect, Option, Redacted } from 'effect';
import { TestClock } from 'effect/testing';
import { MachineAccess } from '../../src/store/access/service.ts';
import { Machines } from '../../src/store/machines/service.ts';
import { Teams } from '../../src/store/teams/service.ts';
import { runTest, TEST_NOW } from '../layers.ts';
import { hashOf, KAI, LAPTOP, MONA, RIO, STUDIO, seedMachine, seedUsers } from './fixtures.ts';

describe('machines', () => {
  test('a new machine is offline, found by its id and by its token hash, its connect key redacted', async () => {
    const [byId, byToken, unknown] = await runTest(
      Effect.gen(function* () {
        const machines = yield* Machines;
        yield* seedUsers(MONA);
        yield* seedMachine(STUDIO, MONA.id, 'a');
        return [
          yield* machines.select(STUDIO),
          yield* machines.selectByToken(hashOf('a')),
          yield* machines.selectByToken(hashOf('b')),
        ] as const;
      })
    );
    const machine = Option.getOrThrow(byId);
    expect(machine).toMatchObject({
      id: STUDIO,
      userId: MONA.id,
      online: false,
      localUrl: null,
      lastSeenAt: null,
      signingKey: null,
      features: [...MACHINE_FEATURES],
      createdAt: TEST_NOW,
    });
    expect(Redacted.value(machine.connectKey)).toBe(`connect-${STUDIO}`);
    expect(String(machine.connectKey)).not.toContain('connect-');
    expect(Option.getOrThrow(byToken).id).toBe(STUDIO);
    expect(Option.isNone(unknown)).toBe(true);
  });

  test('a heartbeat marks it online with its address, keeps the signing key when none is sent, and offline clears online', async () => {
    const [first, second, offline] = await runTest(
      Effect.gen(function* () {
        const machines = yield* Machines;
        yield* seedUsers(MONA);
        yield* seedMachine(STUDIO, MONA.id);
        yield* machines.recordHeartbeat(STUDIO, {
          localUrl: 'http://127.0.0.1:7446',
          signingKey: 'signing-1',
          features: [],
        });
        const readFirst = Option.getOrThrow(yield* machines.select(STUDIO));
        yield* TestClock.adjust('1 minute');
        yield* machines.recordHeartbeat(STUDIO, {
          localUrl: 'http://127.0.0.1:7447',
          signingKey: null,
          features: ['bound-connect-tokens'],
        });
        const readSecond = Option.getOrThrow(yield* machines.select(STUDIO));
        yield* machines.recordOffline(STUDIO);
        return [readFirst, readSecond, Option.getOrThrow(yield* machines.select(STUDIO))] as const;
      })
    );
    expect(first).toMatchObject({
      online: true,
      localUrl: 'http://127.0.0.1:7446',
      signingKey: 'signing-1',
      features: [],
      lastSeenAt: TEST_NOW,
    });
    expect(second).toMatchObject({
      localUrl: 'http://127.0.0.1:7447',
      signingKey: 'signing-1',
      features: ['bound-connect-tokens'],
      lastSeenAt: TEST_NOW + 60_000,
    });
    expect(offline.online).toBe(false);
  });

  test('counts are of every machine and of one owner, and removing one takes its access with it', async () => {
    const [total, owned, others, members] = await runTest(
      Effect.gen(function* () {
        const machines = yield* Machines;
        const access = yield* MachineAccess;
        yield* seedUsers(MONA, KAI);
        yield* seedMachine(STUDIO, MONA.id, 'a');
        yield* seedMachine(LAPTOP, KAI.id, 'b');
        yield* access.members.add(STUDIO, KAI.id);
        const readTotal = yield* machines.count;
        const readOwned = yield* machines.countOwned(MONA.id);
        yield* machines.remove(STUDIO);
        return [readTotal, readOwned, yield* machines.count, yield* access.members.count(STUDIO)] as const;
      })
    );
    expect([total, owned, others, members]).toEqual([2, 1, 1, 0]);
  });

  test("a user's machines are the ones they own, are a member of or a guest of, each with its owner and role", async () => {
    const listed = await runTest(
      Effect.gen(function* () {
        const machines = yield* Machines;
        const access = yield* MachineAccess;
        yield* seedUsers(MONA, KAI, RIO);
        yield* seedMachine(STUDIO, MONA.id, 'a');
        yield* TestClock.adjust('1 second');
        yield* seedMachine(LAPTOP, KAI.id, 'b');
        yield* access.members.add(STUDIO, RIO.id);
        yield* access.guests.add(LAPTOP, RIO.id);
        return [yield* machines.listOfUser(RIO.id), yield* machines.listOfUser(MONA.id)] as const;
      })
    );
    expect(listed[0].map(({ machine, owner, role }) => [machine.id, owner, role])).toEqual([
      [STUDIO, MONA, 'member'],
      [LAPTOP, KAI, 'guest'],
    ]);
    expect(listed[1].map(({ machine, role }) => [machine.id, role])).toEqual([[STUDIO, 'owner']]);
  });

  test('the machines of everyone in a team with the user are listed as a teammate’s, and no one else’s', async () => {
    const [ofKai, ofRio, ofMona] = await runTest(
      Effect.gen(function* () {
        const machines = yield* Machines;
        const teams = yield* Teams;
        const access = yield* MachineAccess;
        yield* seedUsers(MONA, KAI, RIO);
        yield* seedMachine(STUDIO, MONA.id, 'a');
        yield* TestClock.adjust('1 second');
        yield* seedMachine(LAPTOP, RIO.id, 'b');
        const crew = TeamId.make('crew00000001');
        yield* teams.create({ id: crew, userId: MONA.id, name: 'Crew' });
        yield* teams.members.add(crew, KAI.id);
        yield* access.guests.add(STUDIO, KAI.id);
        return [
          yield* machines.listOfUser(KAI.id),
          yield* machines.listOfUser(RIO.id),
          yield* machines.listOfUser(MONA.id),
        ] as const;
      })
    );
    expect(ofKai.map(({ machine, role }) => [machine.id, role])).toEqual([[STUDIO, 'guest']]);
    expect(ofRio.map(({ machine, role }) => [machine.id, role])).toEqual([[LAPTOP, 'owner']]);
    expect(ofMona.map(({ machine, role }) => [machine.id, role])).toEqual([[STUDIO, 'owner']]);
  });

  test('a teammate’s machine reads as theirs to the team’s owner, and the owner’s to a member', async () => {
    const [ofKai, ofMona] = await runTest(
      Effect.gen(function* () {
        const machines = yield* Machines;
        const teams = yield* Teams;
        yield* seedUsers(MONA, KAI);
        yield* seedMachine(STUDIO, MONA.id, 'a');
        yield* TestClock.adjust('1 second');
        yield* seedMachine(LAPTOP, KAI.id, 'b');
        const crew = TeamId.make('crew00000001');
        yield* teams.create({ id: crew, userId: MONA.id, name: 'Crew' });
        yield* teams.members.add(crew, KAI.id);
        return [yield* machines.listOfUser(KAI.id), yield* machines.listOfUser(MONA.id)] as const;
      })
    );
    expect(ofKai.map(({ machine, owner, role }) => [machine.id, owner, role])).toEqual([
      [STUDIO, MONA, 'teammate'],
      [LAPTOP, KAI, 'owner'],
    ]);
    expect(ofMona.map(({ machine, role }) => [machine.id, role])).toEqual([
      [STUDIO, 'owner'],
      [LAPTOP, 'teammate'],
    ]);
  });
});

describe('machine access', () => {
  test('members are added once, listed in the order they joined with their account, and removed', async () => {
    const [has, count, listed, afterRemove] = await runTest(
      Effect.gen(function* () {
        const { members } = yield* MachineAccess;
        yield* seedUsers(MONA, KAI, RIO);
        yield* seedMachine(STUDIO, MONA.id);
        yield* members.add(STUDIO, RIO.id);
        yield* TestClock.adjust('1 second');
        yield* members.add(STUDIO, KAI.id);
        yield* TestClock.adjust('1 second');
        yield* members.add(STUDIO, RIO.id);
        const readHas = yield* members.has(STUDIO, KAI.id);
        const readCount = yield* members.count(STUDIO);
        const readListed = yield* members.list(STUDIO);
        yield* members.remove(STUDIO, KAI.id);
        return [readHas, readCount, readListed, yield* members.has(STUDIO, KAI.id)] as const;
      })
    );
    expect([has, count, afterRemove]).toEqual([true, 2, false]);
    expect(listed).toEqual([
      { user: RIO, addedAt: TEST_NOW },
      { user: KAI, addedAt: TEST_NOW + 1000 },
    ]);
  });

  test('asking again moves a requester to the time of the latest request', async () => {
    const listed = await runTest(
      Effect.gen(function* () {
        const { requesters } = yield* MachineAccess;
        yield* seedUsers(MONA, KAI);
        yield* seedMachine(STUDIO, MONA.id);
        yield* requesters.add(STUDIO, KAI.id);
        yield* TestClock.adjust('5 seconds');
        yield* requesters.add(STUDIO, KAI.id);
        return yield* requesters.list(STUDIO);
      })
    );
    expect(listed).toEqual([{ user: KAI, addedAt: TEST_NOW + 5000 }]);
  });

  test('an invite is one per machine: a new one replaces the old, and a removed one finds nothing', async () => {
    const [old, current, removed] = await runTest(
      Effect.gen(function* () {
        const { invites } = yield* MachineAccess;
        yield* seedUsers(MONA);
        yield* seedMachine(STUDIO, MONA.id);
        yield* invites.replace(STUDIO, hashOf('1'));
        yield* invites.replace(STUDIO, hashOf('2'));
        const readOld = yield* invites.select(hashOf('1'));
        const readCurrent = yield* invites.select(hashOf('2'));
        yield* invites.remove(STUDIO);
        return [readOld, readCurrent, yield* invites.select(hashOf('2'))] as const;
      })
    );
    expect(Option.isNone(old)).toBe(true);
    expect(current).toEqual(Option.some(STUDIO));
    expect(Option.isNone(removed)).toBe(true);
  });

  test('a hand-off is found by its token until its machine removes it', async () => {
    const [found, wrongMachine, removed] = await runTest(
      Effect.gen(function* () {
        const { handoffs } = yield* MachineAccess;
        yield* seedUsers(MONA);
        yield* seedMachine(STUDIO, MONA.id, 'a');
        yield* seedMachine(LAPTOP, MONA.id, 'b');
        yield* handoffs.create(STUDIO, hashOf('3'));
        const readFound = yield* handoffs.select(hashOf('3'));
        yield* handoffs.remove(LAPTOP, hashOf('3'));
        const readWrongMachine = yield* handoffs.select(hashOf('3'));
        yield* handoffs.remove(STUDIO, hashOf('3'));
        return [readFound, readWrongMachine, yield* handoffs.select(hashOf('3'))] as const;
      })
    );
    expect(found).toEqual(Option.some(STUDIO));
    expect(wrongMachine).toEqual(Option.some(STUDIO));
    expect(Option.isNone(removed)).toBe(true);
  });
});
