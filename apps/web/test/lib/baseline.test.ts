import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  BASELINE_DIALOG,
  changeBaseline,
  describeBaselineChange,
  listBaselineItems,
  parseBaselineCommands,
  resolveBaselineMode,
  validateBaselineCommands,
} from '@/lib/baseline.ts';
import { spyOnCommands } from '../support/commands.ts';
import { createRepo } from '../support/state.ts';

let spies: ReturnType<typeof spyOnCommands>;

beforeEach(() => {
  spies = spyOnCommands();
});

afterEach(() => {
  spies.restore();
});

describe('what always runs before review', () => {
  it('is nothing until you set commands, which the choice counts', () => {
    const none = createRepo({ id: 'web' });
    const two = createRepo({ id: 'web', checkCommands: ['bun run lint', 'bun run check-types'] });
    expect([resolveBaselineMode(none), resolveBaselineMode(two)]).toEqual(['none', 'commands']);
    expect(listBaselineItems(none).map((item) => [item.value, item.label])).toEqual([
      ['none', 'Nothing before review'],
      ['commands', 'Commands before review…'],
    ]);
    expect(listBaselineItems(two)[1]?.label).toBe('2 commands before review');
    expect(BASELINE_DIALOG.description).toContain('Leave it empty and nothing extra runs.');
  });

  it('reads one command per line, trimmed, without blanks or repeats, and refuses a long or crowded list', () => {
    expect(parseBaselineCommands(' bun run lint \n\nbun run lint\nbun test a.test.ts\n')).toEqual([
      'bun run lint',
      'bun test a.test.ts',
    ]);
    expect(validateBaselineCommands(['bun run lint'])).toBeNull();
    expect(validateBaselineCommands(['x'.repeat(201)])).toBe(
      `“${'x'.repeat(40)}…” is longer than 200 characters.`
    );
    expect(validateBaselineCommands(Array.from({ length: 13 }, (_, index) => `cmd ${index}`))).toBe(
      'Keep it to 12 commands.'
    );
  });

  it('saves the commands with a toast that says what runs, and sends nothing when they did not change', async () => {
    const web = createRepo({ id: 'web', checkCommands: ['bun run lint'] });
    expect(await changeBaseline(web, ['bun run lint'])).toBe(true);
    expect(spies.sent).not.toHaveBeenCalled();
    await changeBaseline(web, []);
    expect(spies.sent).toHaveBeenCalledWith(
      { type: 'repo.update', repoId: 'web', patch: { checkCommands: [] } },
      'Nothing extra runs before review in web.'
    );
    expect(describeBaselineChange(web, ['a'])).toBe('1 command runs before every review in web.');
    expect(describeBaselineChange(web, ['a', 'b'])).toBe('2 commands run before every review in web.');
  });
});
