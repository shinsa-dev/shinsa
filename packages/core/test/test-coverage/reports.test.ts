import { describe, expect, test } from 'bun:test';
import {
  parseCobertura,
  parseCoverageReport,
  parseGoProfile,
  parseLcov,
} from '../../src/test-coverage/reports.ts';

function serialize(hits: Map<string, Map<number, number>>) {
  return Object.fromEntries([...hits].map(([path, lines]) => [path, Object.fromEntries(lines)]));
}

describe('lcov', () => {
  test('reads every DA line per source file, adding up records of the same file', () => {
    const text = [
      'TN:',
      'SF:/repo/src/a.ts',
      'FN:1,a',
      'DA:1,2',
      'DA:2,0,checksum',
      'end_of_record',
      'SF:src/b.ts',
      'DA:4,1',
      'end_of_record',
      'SF:/repo/src/a.ts',
      'DA:2,3',
      'end_of_record',
    ].join('\r\n');
    expect(serialize(parseLcov(text))).toEqual({
      '/repo/src/a.ts': { 1: 2, 2: 3 },
      'src/b.ts': { 4: 1 },
    });
  });

  test('skips DA lines outside a record and malformed numbers; an empty report has no files', () => {
    expect(serialize(parseLcov('DA:1,1\nSF:x.ts\nDA:zero,1\nDA:0,1\nDA:3,\nDA:4,-2\nend_of_record'))).toEqual(
      {
        'x.ts': { 3: 0, 4: 0 },
      }
    );
    expect(parseLcov('').size).toBe(0);
  });
});

describe('cobertura', () => {
  test('joins each class file name to the sources and reads line hits, whatever the attribute order', () => {
    const text = `<?xml version="1.0" ?>
<coverage line-rate="0.5">
  <sources>
    <source>/home/ci/app/</source>
    <source>lib</source>
  </sources>
  <packages><package name="app"><classes>
    <class name="m" filename="pkg/m.py" line-rate="0.5">
      <methods><method name="f"><lines><line number="2" hits="1"/></lines></method></methods>
      <lines>
        <line number="1" hits="1"/>
        <line hits="0" number="2" branch="false"/>
      </lines>
    </class>
    <class name="abs" filename="/abs/x&amp;y.py"><lines><line number="5" hits="4"/></lines></class>
    <class name="empty" filename=""><lines><line number="1" hits="1"/></lines></class>
    <class name="none"/>
  </classes></package></packages>
</coverage>`;
    expect(serialize(parseCobertura(text))).toEqual({
      '/home/ci/app/pkg/m.py': { 1: 1, 2: 1 },
      'lib/pkg/m.py': { 1: 1, 2: 1 },
      '/abs/x&y.py': { 5: 4 },
    });
  });

  test('a report with no sources keeps the file names as written', () => {
    const text =
      '<coverage><class filename="src\\app.py" name="a"><line number="3" hits="0"/></class></coverage>';
    expect(serialize(parseCobertura(text))).toEqual({ 'src\\app.py': { 3: 0 } });
    expect(parseCobertura('<coverage/>').size).toBe(0);
  });

  test('a Windows path in a class name counts as absolute', () => {
    const text =
      '<coverage><sources><source>C:\\src</source></sources><class filename="C:\\src\\a.py" name="a"><line number="1" hits="1"/></class></coverage>';
    expect([...parseCobertura(text).keys()]).toEqual(['C:\\src\\a.py']);
  });
});

describe('go cover profile', () => {
  test('a block marks every line from its start to its end, covered when any block over the line ran', () => {
    const text = [
      'mode: set',
      'example.com/app/pkg/a.go:3.10,5.2 2 1',
      'example.com/app/pkg/a.go:5.2,7.3 1 0',
      'example.com/app/pkg/a.go:9.1,9.20 0 0',
      'not a block',
      '',
    ].join('\n');
    expect(serialize(parseGoProfile(text))).toEqual({
      'example.com/app/pkg/a.go': { 3: 1, 4: 1, 5: 1, 6: 0, 7: 0 },
    });
  });
});

test('the format picks the parser', () => {
  expect(parseCoverageReport('lcov', 'SF:a\nDA:1,1').get('a')?.get(1)).toBe(1);
  expect(parseCoverageReport('go', 'a.go:1.1,1.2 1 0').get('a.go')?.get(1)).toBe(0);
  expect(
    parseCoverageReport('cobertura', '<class filename="a"><line number="1" hits="2"/></class>').size
  ).toBe(1);
});
