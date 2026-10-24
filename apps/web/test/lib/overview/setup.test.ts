import { describe, expect, it } from 'bun:test';
import { canSkipChecks } from '@/lib/overview/setup.ts';
import { createTask } from '../../support/state.ts';

describe('the setup gate', () => {
  it('lets you start without checks only when checks are all that is missing', () => {
    const checks = { kind: 'check_commands' as const, detail: 'None.' };
    const branch = { kind: 'default_branch' as const, detail: 'Gone.' };
    expect(canSkipChecks(createTask({ id: 't', configProblems: [checks] }))).toBe(true);
    expect(canSkipChecks(createTask({ id: 't', configProblems: [checks, branch] }))).toBe(false);
    expect(canSkipChecks(createTask({ id: 't', configProblems: [] }))).toBe(false);
    expect(canSkipChecks(createTask({ id: 't' }))).toBe(false);
  });
});
