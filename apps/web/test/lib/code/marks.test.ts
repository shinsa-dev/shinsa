import { afterEach, describe, expect, it } from 'bun:test';
import { CODE_MARKS, markCode, measureCode } from '@/lib/code/marks.ts';

afterEach(() => {
  performance.clearMarks();
  performance.clearMeasures();
});

describe('code marks', () => {
  it('measures from opening a file to showing it, once, and only for that file', () => {
    markCode(CODE_MARKS.open, 'a.ts');
    expect(measureCode(CODE_MARKS.shown, 'b.ts')).toBeNull();
    expect(measureCode(CODE_MARKS.shown, 'a.ts')?.name).toBe(CODE_MARKS.shown);
    expect(measureCode(CODE_MARKS.shown, 'a.ts')).toBeNull();
    markCode(CODE_MARKS.toggle, 'src');
    expect(measureCode(CODE_MARKS.toggled, 'src')?.detail).toBe('src');
  });

  it('does nothing where the page cannot time', () => {
    const mark = performance.mark;
    Object.defineProperty(performance, 'mark', { value: undefined, configurable: true });
    markCode(CODE_MARKS.open, 'a.ts');
    expect(measureCode(CODE_MARKS.shown, 'a.ts')).toBeNull();
    Object.defineProperty(performance, 'mark', { value: mark, configurable: true });
  });
});
