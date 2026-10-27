import { describe, expect, test } from 'bun:test';
import { TONE_EDGE_RULE } from './lint-tone-edge.ts';

const isBroken = (line: string) => TONE_EDGE_RULE.pattern.test(line) && !TONE_EDGE_RULE.unless.test(line);

describe('a tone fill takes its tone’s edge', () => {
  test('a toned fill on the grey hairline is caught', () => {
    expect(isBroken("<div className={cn(INSET, 'bg-orange-a2 px-3')}>")).toBe(true);
    expect(isBroken("className='rounded-lg border border-border bg-amber-a2'")).toBe(true);
    expect(isBroken("className='rounded-xl border bg-red-1 p-3'")).toBe(true);
    expect(isBroken("className='border-t bg-green-a1'")).toBe(true);
    expect(isBroken("className='border-bg-3 data-checked:bg-primary-a1'")).toBe(true);
    expect(isBroken('<div className={cn(INSET, TONE_WASH[tone])}>')).toBe(true);
    expect(isBroken(['const BOX = `$', '{INSET} bg-purple-a2`;'].join(''))).toBe(true);
  });

  test('a toned fill on its own tone’s edge passes', () => {
    expect(isBroken("className='rounded-lg border border-orange-a3 bg-orange-a2'")).toBe(false);
    expect(
      isBroken(
        "className='border border-bg-3 has-data-checked:border-primary-a3 has-data-checked:bg-primary-a1'"
      )
    ).toBe(false);
    expect(isBroken('<div className={cn(TONE_INSET[tone], "px-3")}>')).toBe(false);
    expect(isBroken("<div className={cn(INSET, TONE_EDGE[tone], 'bg-red-a2')}>")).toBe(false);
  });

  test('a neutral box, a toned box with no edge, or a name that only ends in INSET is left alone', () => {
    expect(isBroken("<div className={cn(INSET, 'bg-bg-a1')}>")).toBe(false);
    expect(isBroken("className='rounded-full bg-amber-a3'")).toBe(false);
    expect(isBroken("className={cn(CARD_INSET, 'bg-primary-a2')}")).toBe(false);
    expect(isBroken("className='border-border bg-bg-a2'")).toBe(false);
  });
});
