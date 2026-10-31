import { describe, expect, test } from 'bun:test';
import { TOAST_LIMIT, TOAST_MESSAGE } from './lint-rules.ts';
import { listToastViolations } from './lint-toast.ts';

const LONG = 'Approved. Opening the pull request for you now.';
const SHORT = 'Request declined.';

const lines = (files: Record<string, string>) =>
  listToastViolations(files).map((violation) => `${violation.file}:${violation.line}`);

const one = (source: string) => lines({ 'a.ts': source });

describe('a toast is one short line', () => {
  test('a string of the limit passes and one over it is caught, with the copy rule', () => {
    expect(one(`toast.success('${'x'.repeat(TOAST_LIMIT)}');`)).toEqual([]);
    expect(listToastViolations({ 'a.ts': `toast.success('${'x'.repeat(TOAST_LIMIT + 1)}');` })).toEqual([
      { file: 'a.ts', line: 1, message: TOAST_MESSAGE },
    ]);
  });

  test('every toast method, a bare toast and its description are checked', () => {
    for (const method of ['success', 'error', 'info', 'warning', 'message', 'loading'])
      expect(one(`toast.${method}('${LONG}');`)).toEqual(['a.ts:1']);
    expect(one(`toast('${LONG}');`)).toEqual(['a.ts:1']);
    expect(one(`toast.error('${SHORT}', {\n  description: '${LONG}',\n});`)).toEqual(['a.ts:2']);
    expect(one(`toast.other('${LONG}'); other.success('${LONG}');`)).toEqual([]);
  });

  test('the toast helpers are checked at the argument that is the toast', () => {
    expect(one(`confirmDone('${LONG}');`)).toEqual(['a.ts:1']);
    expect(one(`requestWithToast(() => send('${LONG}'), '${LONG}');`)).toEqual(['a.ts:1']);
    expect(one(`sendCommandWithToast({ type: '${LONG}' },\n  '${LONG}');`)).toEqual(['a.ts:2']);
    expect(one(`requestWithToast(run, { title: '${SHORT}', description: '${LONG}' });`)).toEqual(['a.ts:1']);
    expect(one(`log('${LONG}'); confirmDone(42); toString('${LONG}');`)).toEqual([]);
  });

  test('done and sent properties are toast copy', () => {
    expect(one(`const a = { done: '${LONG}' };\nconst b = { sent: '${LONG}' };`)).toEqual([
      'a.ts:1',
      'a.ts:2',
    ]);
    expect(one(`const a = { label: '${LONG}', done: '${SHORT}' };`)).toEqual([]);
  });

  test('an inserted value counts as 12 characters', () => {
    const fixed = 'x'.repeat(TOAST_LIMIT - 12);
    expect(one(`confirmDone(\`${fixed}\${name}\`);`)).toEqual([]);
    expect(one(`confirmDone(\`${fixed}x\${name}\`);`)).toEqual(['a.ts:1']);
    expect(one(`confirmDone('${fixed}' + name);`)).toEqual([]);
    expect(one(`confirmDone('${fixed}x' + name);`)).toEqual(['a.ts:1']);
    expect(one(`confirmDone(name - '${LONG}');`)).toEqual([]);
  });

  test('both branches of a choice are checked', () => {
    expect(one(`confirmDone(ok ? '${SHORT}' :\n  '${LONG}');`)).toEqual(['a.ts:2']);
    expect(one(`confirmDone(text ??\n  '${LONG}');`)).toEqual(['a.ts:2']);
  });

  test('a constant, an object constant and a lookup table are followed to their text', () => {
    expect(one(`const DONE = '${LONG}';\nconfirmDone(DONE as string);`)).toEqual(['a.ts:1']);
    expect(
      one(`const COPY = { added: '${SHORT}',\n  removed: '${LONG}' };\nconfirmDone(COPY.removed);`)
    ).toEqual(['a.ts:2']);
    expect(one(`const COPY = { added: '${SHORT}' } as const;\nconfirmDone(COPY.added);`)).toEqual([]);
    expect(one(`const TOASTS = { a: '${SHORT}',\n  b: '${LONG}' };\nconfirmDone(TOASTS[key]);`)).toEqual([
      'a.ts:2',
    ]);
    expect(one(`const list = ['${LONG}'];\nconfirmDone(list.at);\nconfirmDone(other.done);`)).toEqual([]);
    expect(one(`const loop = loop;\nconfirmDone(loop);\nconfirmDone(unknown);`)).toEqual([]);
  });

  test('a function that returns the text is followed, in another file too', () => {
    const copy = `export function describeRemoved(name: string) {\n  const inner = () => '${LONG}';\n  if (name) return '${SHORT}';\n  return '${LONG}';\n}`;
    expect(lines({ 'copy.ts': copy, 'use.ts': 'confirmDone(describeRemoved(name));' })).toEqual([
      'copy.ts:4',
    ]);
    expect(lines({ 'a.ts': `const describe = () => '${LONG}';\ntoast.error(describe());` })).toEqual([
      'a.ts:1',
    ]);
    expect(
      lines({ 'a.ts': `const copy = { describe() { return '${LONG}'; } };\nconfirmDone(copy.describe());` })
    ).toEqual(['a.ts:1']);
  });

  test('a function that takes a done argument is a toast helper wherever it is called', () => {
    const helper =
      'export function updateAccount(id: string, done = DEFAULT) {\n  return requestWithToast(() => send(id), done);\n}';
    const api =
      'export const actions = { remove: (project, sent) => run(project, sent), [key]: () => null };';
    expect(
      lines({
        'helper.ts': helper,
        'api.ts': api,
        'use.ts': `updateAccount('${LONG}', '${LONG}');\nactions.remove(project, '${LONG}');\nactions.remove(project);`,
      })
    ).toEqual(['use.ts:1', 'use.ts:2']);
    expect(lines({ 'a.ts': 'export default function () {}\nconst noop = 1;' })).toEqual([]);
  });

  test('violations come back ordered by file and line', () => {
    expect(lines({ 'b.ts': `toast('${LONG}');`, 'a.ts': `\ntoast('${LONG}');\ntoast('${LONG}');` })).toEqual([
      'a.ts:2',
      'a.ts:3',
      'b.ts:1',
    ]);
  });
});
