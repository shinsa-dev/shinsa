import { describe, expect, test } from 'bun:test';
import { Option } from 'effect';
import {
  resolveCoverageFormat,
  resolveCustomFormat,
  resolveRepoCoverage,
} from '../../src/test-coverage/setting.ts';

describe('the coverage setting', () => {
  test('a repository without one measures automatically, and never shares the default', () => {
    const first = resolveRepoCoverage({});
    expect(first).toEqual({ mode: 'auto' });
    Object.assign(first, { mode: 'off' });
    expect(resolveRepoCoverage(null)).toEqual({ mode: 'auto' });
    expect(resolveRepoCoverage({ coverage: { mode: 'off' } })).toEqual({ mode: 'off' });
  });

  test('the report name tells its format when it can', () => {
    expect(Option.getOrNull(resolveCoverageFormat('coverage/lcov.info'))).toBe('lcov');
    expect(Option.getOrNull(resolveCoverageFormat('out/lcov-report'))).toBe('lcov');
    expect(Option.getOrNull(resolveCoverageFormat('cover.lcov'))).toBe('lcov');
    expect(Option.getOrNull(resolveCoverageFormat(' coverage.xml '))).toBe('cobertura');
    expect(Option.getOrNull(resolveCoverageFormat('cover.out'))).toBe('go');
    expect(Option.getOrNull(resolveCoverageFormat('c.coverprofile'))).toBe('go');
    expect(Option.getOrNull(resolveCoverageFormat('coverage/data.json'))).toBeNull();
  });

  test('a custom setting’s own format wins over the name', () => {
    expect(
      Option.getOrNull(
        resolveCustomFormat({ mode: 'custom', command: 'x', report: 'cover.out', format: 'lcov' })
      )
    ).toBe('lcov');
    expect(
      Option.getOrNull(
        resolveCustomFormat({ mode: 'custom', command: 'x', report: 'cover.out', format: null })
      )
    ).toBe('go');
  });
});
