import { describe, expect, it, mock } from 'bun:test';
import { listReviewCommands } from '@/lib/command/review.ts';

describe('listReviewCommands', () => {
  it('steps through the places with their keys', () => {
    const step = mock((_step: 1 | -1) => {});
    const section = listReviewCommands({ taskId: 't1', count: 3, step });
    expect(section.heading).toBe('Review');
    expect(section.commands.map((command) => [command.label, command.trailing, command.disabled])).toEqual([
      ['Next place to check', 'J', undefined],
      ['Previous place to check', 'K', undefined],
    ]);
    for (const command of section.commands) if (command.kind === 'run') command.run();
    expect(step.mock.calls).toEqual([[1], [-1]]);
  });

  it('says why when nothing needs your attention', () => {
    const section = listReviewCommands({ taskId: 't1', count: 0, step: () => {} });
    expect(section.commands.map((command) => command.disabled)).toEqual([
      'Nothing in this review needs your attention',
      'Nothing in this review needs your attention',
    ]);
  });
});
