import { describe, expect, it } from 'bun:test';
import { type CommentSpan, scanCommentLine } from '@/lib/code/comment-tags.ts';

function whole(line: string): CommentSpan[] {
  return [{ from: 0, to: line.length }];
}

function tagOf(line: string, spans: CommentSpan[] = whole(line), plainBlock = false, first = false) {
  return scanCommentLine(line, spans, plainBlock, first).tagged;
}

function scanBlock(lines: string[]) {
  let plainBlock = false;
  return lines.map((line) => {
    const scan = scanCommentLine(line, whole(line), plainBlock, false);
    plainBlock = scan.plainBlock;
    return scan.tagged;
  });
}

describe('scanCommentLine', () => {
  it('tags a line comment by what follows its marker, from the marker to the end', () => {
    expect(tagOf('// ! Do not call this twice')).toEqual({ from: 0, tag: 'alert' });
    expect(tagOf('// ? Why is this here')).toEqual({ from: 0, tag: 'query' });
    expect(tagOf('// TODO: split this up')).toEqual({ from: 0, tag: 'todo' });
    expect(tagOf('//todo remove')).toEqual({ from: 0, tag: 'todo' });
    expect(tagOf('// * The important part')).toEqual({ from: 0, tag: 'highlight' });
    expect(tagOf('//// const old = true;')).toEqual({ from: 0, tag: 'strike' });
    expect(tagOf('// A plain note')).toBeNull();
    expect(tagOf('/// <reference path="x" />')).toBeNull();
  });

  it('takes the last of several tags, as the extension does', () => {
    expect(tagOf('// !? Unsure')).toEqual({ from: 0, tag: 'query' });
  });

  it('reads every line marker the grammars scope as a comment', () => {
    expect(tagOf('# ! Python')).toEqual({ from: 0, tag: 'alert' });
    expect(tagOf('-- ? SQL')).toEqual({ from: 0, tag: 'query' });
    expect(tagOf(';; TODO Lisp')).toEqual({ from: 0, tag: 'todo' });
    expect(tagOf('% * TeX')).toEqual({ from: 0, tag: 'highlight' });
  });

  it('finds a trailing comment after code, starting at its marker', () => {
    const line = 'const a = 1; // ! Mutable';
    expect(tagOf(line, [{ from: 12, to: line.length }])).toEqual({ from: 13, tag: 'alert' });
  });

  it('leaves the shebang of a script alone but not a later #! comment', () => {
    expect(tagOf('#!/usr/bin/env bash', undefined, false, true)).toBeNull();
    expect(tagOf('#! Careful', undefined, false, false)).toEqual({ from: 0, tag: 'alert' });
  });

  it('tags documentation comment lines after their margin star, not the opening or closing line', () => {
    expect(
      scanBlock(['/**', ' * Plain words.', ' * ! Throws when empty.', ' * TODO: cover it', ' * * Key', ' */'])
    ).toEqual([
      null,
      null,
      { from: 3, tag: 'alert' },
      { from: 3, tag: 'todo' },
      { from: 3, tag: 'highlight' },
      null,
    ]);
  });

  it('reads a documentation line whose comment is split by a tag of its own', () => {
    const line = ' * ! @param name The name';
    expect(
      tagOf(line, [
        { from: 0, to: 5 },
        { from: 11, to: line.length },
      ])
    ).toEqual({ from: 3, tag: 'alert' });
  });

  it('treats a leading star in a plain block comment as the highlight tag, as the extension does', () => {
    expect(scanBlock(['/* ', ' * Every starred line', ' ! An alert', '*/', ' * After the block'])).toEqual([
      null,
      { from: 1, tag: 'highlight' },
      { from: 1, tag: 'alert' },
      null,
      null,
    ]);
  });

  it('closes a plain block on the line that ends it', () => {
    const scan = scanCommentLine(' ! Last line */', whole(' ! Last line */'), true, false);
    expect(scan).toEqual({ tagged: { from: 1, tag: 'alert' }, plainBlock: false });
  });

  it('tags block lines of every language at their first word, and needs words after the tag', () => {
    expect(scanBlock(['"""', '    TODO: write this', '    ?', '"""'])).toEqual([
      null,
      { from: 4, tag: 'todo' },
      null,
      null,
    ]);
    expect(scanBlock(['<!--', '  ! Generated file', '-->'])).toEqual([null, { from: 2, tag: 'alert' }, null]);
    expect(scanBlock(['--[[', '  ? Lua', ']]'])).toEqual([null, { from: 2, tag: 'query' }, null]);
  });

  it('never tags a comment that opens on its line', () => {
    expect(tagOf('/* ! Not tagged */')).toBeNull();
    expect(scanCommentLine('/* one line */', whole('/* one line */'), false, false).plainBlock).toBe(false);
    expect(scanCommentLine('/*', whole('/*'), false, false).plainBlock).toBe(true);
    expect(scanCommentLine('/** doc', whole('/** doc'), false, false).plainBlock).toBe(false);
  });
});
