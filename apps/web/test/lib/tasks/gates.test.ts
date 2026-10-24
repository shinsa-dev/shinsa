import { describe, expect, it } from 'bun:test';
import { resolvePlanReply } from '@/lib/tasks/gates.ts';
import { createTask } from '../../support/state.ts';

describe('resolvePlanReply', () => {
  it('says the operation runs next when an operation’s plan is approved, and building otherwise', () => {
    expect(resolvePlanReply(createTask({ id: 't', pipeline: ['plan', 'operate'] }))).toBe(
      'approveOperationPlan'
    );
    expect(resolvePlanReply(createTask({ id: 't', pipeline: ['plan', 'operate', 'build'] }))).toBe(
      'approveOperationPlan'
    );
    expect(resolvePlanReply(createTask({ id: 't', pipeline: ['plan', 'build', 'checks'] }))).toBe(
      'approvePlan'
    );
  });
});
