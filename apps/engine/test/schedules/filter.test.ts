import { describe, expect, test } from 'bun:test';
import type { Schedule } from '@shinsa/core';
import { Effect } from 'effect';
import { ScheduleFilter } from '../../src/schedules/filter/service.ts';
import { createTestFilter } from './fixtures.ts';

const SUBJECT = { label: 'The request to its webhook', tag: 'webhook-data', body: 'POST /api/hooks/s1' };

function applies(schedule: Pick<Schedule, 'text' | 'source'>, answer: unknown) {
  const asked: string[] = [];
  const layer = createTestFilter(<T>(_system: string, prompt: string) => {
    asked.push(prompt);
    return Effect.succeed(answer as T);
  });
  const applied = Effect.runPromise(
    ScheduleFilter.use((filter) => filter.applies(schedule as Schedule, SUBJECT)).pipe(Effect.provide(layer))
  );
  return { applied, asked };
}

describe('whether an automation applies to what arrived', () => {
  test('a watch is never asked about: its read decides what to file', async () => {
    const { applied, asked } = applies(
      { text: 'File each new report.', source: { projectId: 'p1', server: 'slack' } },
      { decision: 'skip' }
    );
    expect(await applied).toBe(true);
    expect(asked).toEqual([]);
  });

  test('a trigger is skipped only on a clear skip', async () => {
    expect(await applies({ text: 'Only failures.', source: null }, { decision: 'skip' }).applied).toBe(false);
    expect(await applies({ text: 'Only failures.', source: null }, { decision: 'file' }).applied).toBe(true);
    expect(await applies({ text: 'Only failures.', source: null }, null).applied).toBe(true);
  });
});
