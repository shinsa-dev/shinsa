import { describe, expect, it } from 'bun:test';
import { describeRequest } from '@/lib/tasks/request.ts';
import { createTask } from '../../support/state.ts';

describe('describeRequest', () => {
  it('hides a request that only repeats the title', () => {
    expect(
      describeRequest(createTask({ id: 't', title: 'Fix the login', request: 'fix the login!' }))
    ).toBeNull();
    expect(describeRequest(createTask({ id: 't', request: '   ' }))).toBeNull();
  });

  it('shows a short request trimmed', () => {
    expect(
      describeRequest(createTask({ id: 't', title: 'Fix login', request: '  Users get logged out.  ' }))
    ).toEqual({
      text: 'Users get logged out.',
      long: false,
    });
  });

  it('marks a request long when it runs past 160 characters or spans lines', () => {
    expect(describeRequest(createTask({ id: 't', request: 'x'.repeat(161) }))?.long).toBe(true);
    expect(describeRequest(createTask({ id: 't', request: 'x'.repeat(160) }))?.long).toBe(false);
    expect(describeRequest(createTask({ id: 't', request: 'First line\nSecond line' }))?.long).toBe(true);
  });
});
