import { describe, expect, it } from 'bun:test';
import { describeIntent } from '@/lib/tasks/intent.ts';
import { createTask } from '../../support/state.ts';

describe('describeIntent', () => {
  it('hides an intent that only repeats the title', () => {
    expect(
      describeIntent(createTask({ id: 't', title: 'Fix the login', intent: 'fix the login!' }))
    ).toBeNull();
    expect(describeIntent(createTask({ id: 't', intent: '   ' }))).toBeNull();
  });

  it('shows a short intent trimmed', () => {
    expect(
      describeIntent(createTask({ id: 't', title: 'Fix login', intent: '  Users get logged out.  ' }))
    ).toEqual({
      text: 'Users get logged out.',
      long: false,
    });
  });

  it('marks an intent long when it runs past 160 characters or spans lines', () => {
    expect(describeIntent(createTask({ id: 't', intent: 'x'.repeat(161) }))?.long).toBe(true);
    expect(describeIntent(createTask({ id: 't', intent: 'x'.repeat(160) }))?.long).toBe(false);
    expect(describeIntent(createTask({ id: 't', intent: 'First line\nSecond line' }))?.long).toBe(true);
  });
});
