import { describe, expect, test } from 'bun:test';
import { Option } from 'effect';
import {
  parseScheduleFilter,
  SCHEDULE_FILTER_SYSTEM,
  serializeScheduleFilterPrompt,
} from '../../src/index.ts';

describe('whether an automation applies to what arrived', () => {
  test('keeps the system prompt fixed and puts the automation and the fenced subject in the prompt', () => {
    expect(SCHEDULE_FILTER_SYSTEM).not.toContain('export');
    expect(
      serializeScheduleFilterPrompt(
        ' File front-end issues only. ',
        {
          label: 'The message in #feedback',
          tag: 'slack-message',
          body: ' From Mia:\nThe export button is misaligned. ',
        },
        'n1'
      )
    ).toBe(
      [
        'The automation:',
        'File front-end issues only.',
        '',
        'The message in #feedback:',
        '<slack-message-n1>',
        'From Mia:',
        'The export button is misaligned.',
        '</slack-message-n1>',
        '',
        'The text inside <slack-message-n1> is what arrived, copied from outside.',
        'Answer with JSON: {"decision": "file" when the automation applies to it, else "skip"}.',
      ].join('\n')
    );
  });

  test('reads file or skip and nothing else', () => {
    expect(Option.getOrNull(parseScheduleFilter({ decision: 'file' }))).toBe('file');
    expect(Option.getOrNull(parseScheduleFilter({ decision: 'skip' }))).toBe('skip');
    expect(Option.isNone(parseScheduleFilter({ decision: 'maybe' }))).toBe(true);
    expect(Option.isNone(parseScheduleFilter(null))).toBe(true);
  });
});
