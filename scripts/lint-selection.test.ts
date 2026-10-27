import { describe, expect, test } from 'bun:test';
import { RAW_SELECTION_PATTERN, SELECTION_CLASS_RULE } from './lint-selection.ts';

const isAdHoc = (line: string) => SELECTION_CLASS_RULE.pattern.test(line);

describe('selection goes through the kit’s one class', () => {
  test('a hand-made selection or text cursor is caught', () => {
    expect(isAdHoc("className='select-text text-xs'")).toBe(true);
    expect(isAdHoc("className='cursor-text select-text'")).toBe(true);
    expect(isAdHoc('className="md:select-all"')).toBe(true);
    expect(isAdHoc("cn('px-2', 'select-auto')")).toBe(true);
  });

  test('the shared class, select-none and other cursors pass', () => {
    expect(isAdHoc("className='selectable min-w-0'")).toBe(false);
    expect(isAdHoc("className='select-none'")).toBe(false);
    expect(isAdHoc("className='cursor-pointer cursor-text-foo'")).toBe(false);
  });

  test('user-select set by hand is caught in either spelling', () => {
    expect(RAW_SELECTION_PATTERN.test("document.body.style.userSelect = 'none';")).toBe(true);
    expect(RAW_SELECTION_PATTERN.test("style={{ WebkitUserSelect: 'text' }}")).toBe(true);
    expect(RAW_SELECTION_PATTERN.test('user-select: none;')).toBe(true);
    expect(RAW_SELECTION_PATTERN.test('document.body.dataset.dragging = "";')).toBe(false);
  });
});
