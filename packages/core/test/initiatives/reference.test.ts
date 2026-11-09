import { describe, expect, test } from 'bun:test';
import { selectInitiativeByReference } from '../../src/domain/index.ts';

const INITIATIVES = [
  { id: '01a1-chat-split', name: 'Chat split' },
  { id: '01a2-onboarding', name: 'Onboarding' },
];

describe('selectInitiativeByReference', () => {
  test('finds an initiative by its id, its name in any case, or the start of its id', () => {
    expect(selectInitiativeByReference(INITIATIVES, '01a2-onboarding')?.name).toBe('Onboarding');
    expect(selectInitiativeByReference(INITIATIVES, '  chat SPLIT ')?.id).toBe('01a1-chat-split');
    expect(selectInitiativeByReference(INITIATIVES, '01a2')?.name).toBe('Onboarding');
  });

  test('an exact id or name wins over the start of another id', () => {
    const shadowed = [
      { id: 'abc-long', name: 'First' },
      { id: 'abc', name: 'Second' },
    ];
    expect(selectInitiativeByReference(shadowed, 'abc')?.name).toBe('Second');
    expect(
      selectInitiativeByReference(
        [
          { id: 'x1', name: 'x' },
          { id: 'x', name: 'Other' },
        ],
        'x'
      )?.id
    ).toBe('x');
  });

  test('finds nothing for a blank or unknown reference', () => {
    expect(selectInitiativeByReference(INITIATIVES, '   ')).toBeNull();
    expect(selectInitiativeByReference(INITIATIVES, 'Billing')).toBeNull();
  });
});
