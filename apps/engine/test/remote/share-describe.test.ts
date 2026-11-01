import { describe, expect, test } from 'bun:test';
import type { Task } from '@shinsa/core';
import { createShareDescriber, describeSharePrompt } from '../../src/remote/share-describe.ts';

const TASK = {
  title: 'Scroll tab groups horizontally',
  request:
    'Tab groups do not scroll when there are too many tabs.\n\n<attachments>\n<attachment kind="image" display_name="shot.png" path="/data/attachments/01b/shot.png" url="/api/attachments/01b/shot.png" />\n</attachments>',
} as Task;

function createAsk(answer: unknown) {
  const calls: { system: string; prompt: string; schema: unknown }[] = [];
  const ask = <T>(system: string, prompt: string, schema?: unknown) => {
    calls.push({ system, prompt, schema });
    return Promise.resolve(answer as T | null);
  };
  return { ask, calls };
}

describe('describing a shared task', () => {
  test('asks the writer with the title and the request without attachments, and keeps one tidy line', async () => {
    const { ask, calls } = createAsk({ description: '  Tab groups now scroll\n sideways when full. ' });
    expect(await createShareDescriber(ask)(TASK)).toBe('Tab groups now scroll sideways when full.');
    expect(calls[0]?.prompt).toBe(describeSharePrompt(TASK));
    expect(calls[0]?.prompt).toBe(
      'Title: Scroll tab groups horizontally\nRequest:\nTab groups do not scroll when there are too many tabs.'
    );
    expect(calls[0]?.system).toContain('never copy it');
    expect(calls[0]?.schema).toMatchObject({ required: ['description'] });
  });

  test('gives nothing when the writer gave nothing, an empty line or too much', async () => {
    expect(await createShareDescriber(createAsk(null).ask)(TASK)).toBeNull();
    expect(await createShareDescriber(createAsk({ description: '  ' }).ask)(TASK)).toBeNull();
    expect(await createShareDescriber(createAsk({ description: 4 }).ask)(TASK)).toBeNull();
    expect(await createShareDescriber(createAsk({ description: 'x'.repeat(401) }).ask)(TASK)).toBeNull();
  });
});
