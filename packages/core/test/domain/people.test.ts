import { describe, expect, test } from 'bun:test';
import {
  type Activity,
  resolveFirstName,
  resolveGuestFirstName,
  selectTaskPerson,
  type TaskGuest,
} from '../../src/index.ts';

const KAI: TaskGuest = { id: 'u-kai', login: 'kai', name: 'Kai Lane', avatarUrl: 'kai.png' };

function entry(person?: Activity['person']): Activity {
  return { at: 1, actor: 'shinsa', kind: 'stage', text: 'Handed', detail: null, evidenceId: null, person };
}

describe('people', () => {
  test('a first name comes from the name, else the login', () => {
    expect(resolveFirstName({ login: 'kai', name: ' Kai Lane ' })).toBe('Kai');
    expect(resolveFirstName({ login: 'kai', name: null })).toBe('kai');
  });

  test('finds the guest a task names, from its hand-off or its activity', () => {
    const handedOff = { handoff: { at: 1, url: null, guest: KAI, claimedAt: 1 }, activity: [] };
    expect(selectTaskPerson(handedOff, 'kai')).toEqual({
      login: 'kai',
      name: 'Kai Lane',
      avatarUrl: 'kai.png',
    });
    const backAgain = {
      handoff: null,
      activity: [
        entry({ login: 'kai', name: 'Kai', avatarUrl: null }),
        entry(),
        entry({ login: 'kai', name: 'Kai Lane', avatarUrl: null }),
      ],
    };
    expect(selectTaskPerson(backAgain, 'kai')?.name).toBe('Kai Lane');
    expect(selectTaskPerson(backAgain, 'robin')).toBeNull();
  });

  test('a guest is named by first name when the task knows them, else by login', () => {
    const task = { handoff: { at: 1, url: null, guest: KAI, claimedAt: 1 }, activity: [] };
    expect(resolveGuestFirstName(task, 'kai')).toBe('Kai');
    expect(resolveGuestFirstName(task, 'robin')).toBe('robin');
    expect(resolveGuestFirstName(undefined, 'kai')).toBe('kai');
  });
});
