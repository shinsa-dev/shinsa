import { describe, expect, test } from 'bun:test';
import { Result } from 'effect';
import { createState, decide, DomainError, SCOPE_MESSAGES, type ShinsaState } from '../../src/index.ts';

const CONTEXT = { now: 1_000, newId: () => 'id1' };

describe('decide returns a Result', () => {
  test('a decision is a success', () => {
    const result = decide(createState(), { type: 'settings.change', patch: { maxFixRounds: 4 } }, CONTEXT);
    expect(Result.isSuccess(result)).toBe(true);
    expect(Result.getOrThrow(result).events.map((event) => event.type)).toEqual(['settings.changed']);
  });

  test('a refused command is a failure with its code and message', () => {
    const result = decide(
      createState(),
      { type: 'gate.answer', gateId: 'missing', decision: 'approve', response: null },
      CONTEXT
    );
    const failure = Result.isFailure(result) ? result.failure : null;
    expect(failure).toBeInstanceOf(DomainError);
    expect(failure?.code).toBe('gate_not_found');
  });

  test('a guest outside its task is refused before anything is decided', () => {
    const result = decide(
      createState(),
      { type: 'settings.change', patch: { maxFixRounds: 4 } },
      { ...CONTEXT, guest: { taskId: 't1', login: 'kai' } }
    );
    const failure = Result.isFailure(result) ? result.failure : null;
    expect(failure?.code).toBe('handoff_scope');
    expect(failure?.message).toBe(SCOPE_MESSAGES.command);
  });

  test('a bug that is not a domain error still throws', () => {
    expect(() =>
      decide(null as unknown as ShinsaState, { type: 'settings.change', patch: {} }, CONTEXT)
    ).toThrow(TypeError);
  });
});
