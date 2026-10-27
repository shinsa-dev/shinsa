import { describe, expect, test } from 'bun:test';
import {
  createTesting,
  hasTesting,
  isWebUrl,
  listTestingLines,
  parseTestFile,
  serializeTestFile,
} from '../../src/index.ts';

describe('the testing guide', () => {
  test('starts empty, or with what the tests cover', () => {
    expect(createTesting()).toEqual({ automated: [], manual: [] });
    expect(createTesting(['Covered.'])).toEqual({ automated: ['Covered.'], manual: [] });
  });

  test('has something to show once either part has a line', () => {
    expect(hasTesting(null)).toBe(false);
    expect(hasTesting(createTesting())).toBe(false);
    expect(hasTesting(createTesting(['Covered.']))).toBe(true);
    expect(
      hasTesting({ automated: [], manual: [{ action: 'Open it.', target: null, expect: 'It opens.' }] })
    ).toBe(true);
  });

  test('takes only http and https addresses as web links', () => {
    expect(isWebUrl(' https://preview.example.com/paywalls ')).toBe(true);
    expect(isWebUrl('http://localhost:5173')).toBe(true);
    expect(isWebUrl('javascript:alert(1)')).toBe(false);
    expect(isWebUrl('https://a b')).toBe(false);
  });

  test('reads a file as a path, a path with a line or range, or a file reference', () => {
    expect(parseTestFile('src/a.ts')).toEqual({ path: 'src/a.ts', line: null, end: null });
    expect(parseTestFile(' src/a.ts:12 ')).toEqual({ path: 'src/a.ts', line: 12, end: null });
    expect(parseTestFile('src/a.ts:12-20')).toEqual({ path: 'src/a.ts', line: 12, end: 20 });
    expect(parseTestFile('shinsa://file/src/a.ts#L3-L4')).toEqual({ path: 'src/a.ts', line: 3, end: 4 });
    expect(parseTestFile('../a.ts')).toBeNull();
    expect(parseTestFile('shinsa://task/abc')).toBeNull();
  });

  test('writes a file back as path:line-end', () => {
    expect(serializeTestFile({ path: 'src/a.ts', line: null, end: null })).toBe('src/a.ts');
    expect(serializeTestFile({ path: 'src/a.ts', line: 12, end: null })).toBe('src/a.ts:12');
    expect(serializeTestFile({ path: 'src/a.ts', line: 12, end: 20 })).toBe('src/a.ts:12-20');
  });

  test('lists both parts for an agent, each step with its target and what to expect', () => {
    expect(listTestingLines(undefined)).toEqual([]);
    expect(
      listTestingLines({
        automated: ['duplicate.test.ts covers both kinds.'],
        manual: [
          { action: 'Start the app.', target: { kind: 'command', value: 'bun dev' }, expect: 'A local URL.' },
          { action: 'Try an empty name.', target: null, expect: 'It is refused.' },
        ],
      })
    ).toEqual([
      'Covered by tests:',
      '- duplicate.test.ts covers both kinds.',
      'Try it yourself:',
      '1. Start the app. [command: bun dev] Expected: A local URL.',
      '2. Try an empty name. Expected: It is refused.',
    ]);
  });
});
