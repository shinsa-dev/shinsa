import { describe, expect, test } from 'bun:test';
import { listDialogViolations } from './lint-dialog.ts';
import { DIALOG_DESCRIPTION_LIMIT, DIALOG_DESCRIPTION_MESSAGE } from './lint-rules.ts';

const LONG = 'x'.repeat(DIALOG_DESCRIPTION_LIMIT + 1);

const FITS = 'x'.repeat(DIALOG_DESCRIPTION_LIMIT);

const lines = (files: Record<string, string>) =>
  listDialogViolations(files).map((violation) => `${violation.file}:${violation.line}`);

const one = (source: string) => lines({ 'a.tsx': source });

describe('a dialog description is at most two lines', () => {
  test('text of the limit passes and one over it is caught, with the rule', () => {
    expect(one(`<DialogDescription>${FITS}</DialogDescription>;`)).toEqual([]);
    expect(listDialogViolations({ 'a.tsx': `<DialogDescription>${LONG}</DialogDescription>;` })).toEqual([
      { file: 'a.tsx', line: 1, message: DIALOG_DESCRIPTION_MESSAGE },
    ]);
    expect(one(`<AlertDialogDescription>${LONG}</AlertDialogDescription>;`)).toEqual(['a.tsx:1']);
    expect(one(`<Other>${LONG}</Other>;`)).toEqual([]);
    expect(
      lines({
        'b.tsx': `<DialogDescription>${LONG}</DialogDescription>;\n<DialogDescription>${LONG}</DialogDescription>;`,
        'a.tsx': `<DialogDescription>${LONG}</DialogDescription>;`,
      })
    ).toEqual(['a.tsx:1', 'b.tsx:1', 'b.tsx:2']);
  });

  test('a constant is followed to where it is written, in any file', () => {
    expect(
      lines({
        'copy.ts': `export const COPY = {\n  description: '${LONG}',\n};`,
        'a.tsx': `import { COPY } from './copy.ts';\n<DialogDescription>{COPY.description}</DialogDescription>;`,
      })
    ).toEqual(['copy.ts:2']);
    expect(one(`const D = '${FITS}';\n<DialogDescription>{D}</DialogDescription>;`)).toEqual([]);
  });

  test('mixed text and values add up, an unread value counting as 12', () => {
    const half = 'x'.repeat(DIALOG_DESCRIPTION_LIMIT / 2);
    expect(one(`<DialogDescription>${half} <b>{name}</b> ${'x'.repeat(40)}</DialogDescription>;`)).toEqual(
      []
    );
    expect(one(`<DialogDescription>\n  ${half} <b>{name}</b> ${half}</DialogDescription>;`)).toEqual([
      'a.tsx:1',
    ]);
    expect(one(`<DialogDescription>{a}{' '}{b}{/* none */}</DialogDescription>;`)).toEqual([]);
    expect(one(`<DialogDescription>{...parts}</DialogDescription>;`)).toEqual([]);
  });

  test('the description of a confirmation and a percent dialog is checked', () => {
    expect(one(`<ConfirmDialog title='Remove?' body='${LONG}' />;`)).toEqual(['a.tsx:1']);
    expect(one(`<ConfirmDialog title='Remove?' body={\`\${name} ${LONG}\`} />;`)).toEqual(['a.tsx:1']);
    expect(one(`<PercentDialog description='${FITS}' />;`)).toEqual([]);
    expect(one(`<ConfirmDialog title='Remove?' />;`)).toEqual([]);
  });
});
