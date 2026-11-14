import { describe, expect, test } from 'bun:test';
import { parse } from '@babel/parser';
import { type AstNode, visit } from './lint-ast.ts';
import { isStrayKeyListener, SHORTCUT_FILES } from './lint-shortcut.ts';

const strayLines = (file: string, source: string) => {
  const program = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
    .program as unknown as AstNode;
  const lines: number[] = [];
  visit(program, (node) => {
    if (isStrayKeyListener(file, node)) lines.push(node.loc?.start.line ?? 0);
  });
  return lines;
};

const LISTENER = "window.addEventListener('keydown', onKeyDown);\naddEventListener('keyup', onKeyUp);";

describe('keyboard shortcuts live in the shortcut files', () => {
  test('a global key listener anywhere else is caught', () => {
    expect(strayLines('apps/web/src/components/home/list.tsx', LISTENER)).toEqual([1, 2]);
  });

  test('the app-wide shortcuts listener is one of the files allowed to listen', () => {
    expect(SHORTCUT_FILES).toContain('apps/web/src/hooks/use-app-shortcuts.ts');
    for (const file of SHORTCUT_FILES) expect(strayLines(file, LISTENER)).toEqual([]);
  });

  test('other events and other calls are left alone', () => {
    const source = "window.addEventListener('pointerover', onOver);\nother.listen('keydown');";
    expect(strayLines('apps/web/src/components/home/list.tsx', source)).toEqual([]);
  });
});
