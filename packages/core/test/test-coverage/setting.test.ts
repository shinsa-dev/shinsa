import { describe, expect, test } from 'bun:test';
import {
  resolveCoverageFormat,
  resolveCustomFormat,
  resolveRepoCoverage,
} from '../../src/test-coverage/setting.ts';

describe('the coverage setting', () => {
  test('a repository without one measures automatically, and never shares the default', () => {
    const first = resolveRepoCoverage({});
    expect(first).toEqual({ mode: 'auto' });
    first.mode = 'off';
    expect(resolveRepoCoverage(null)).toEqual({ mode: 'auto' });
    expect(resolveRepoCoverage({ coverage: { mode: 'off' } })).toEqual({ mode: 'off' });
  });

  test('the report name tells its format when it can', () => {
    expect(resolveCoverageFormat('coverage/lcov.info')).toBe('lcov');
    expect(resolveCoverageFormat('out/lcov-report')).toBe('lcov');
    expect(resolveCoverageFormat('cover.lcov')).toBe('lcov');
    expect(resolveCoverageFormat(' coverage.xml ')).toBe('cobertura');
    expect(resolveCoverageFormat('cover.out')).toBe('go');
    expect(resolveCoverageFormat('c.coverprofile')).toBe('go');
    expect(resolveCoverageFormat('coverage/data.json')).toBeNull();
  });

  test('a custom setting’s own format wins over the name', () => {
    expect(resolveCustomFormat({ mode: 'custom', command: 'x', report: 'cover.out', format: 'lcov' })).toBe(
      'lcov'
    );
    expect(resolveCustomFormat({ mode: 'custom', command: 'x', report: 'cover.out', format: null })).toBe(
      'go'
    );
  });
});
