import { describe, expect, it } from 'bun:test';
import { createShikiEngine } from '@/lib/code/editor/shiki-engine.ts';
import {
  createTokenizer,
  isTokenFailure,
  type TokenAnswer,
  unpackLines,
} from '@/lib/code/editor/textmate.ts';

async function tokenize(grammar: string, text: string) {
  const answers: TokenAnswer[] = [];
  const tokenizer = createTokenizer(createShikiEngine(), (answer) => answers.push(answer));
  await tokenizer.tokenize({
    id: 1,
    doc: 'a',
    grammar,
    text,
    version: 0,
    known: false,
    need: null,
    priority: 1,
  });
  const replies = answers.flatMap((answer) => (isTokenFailure(answer) ? [] : [answer]));
  const last = replies.at(-1);
  if (!last) return null;
  const all: Uint32Array[] = [];
  for (const reply of replies)
    for (const [index, line] of unpackLines(reply.offsets, reply.data).entries())
      all[reply.from + index] = line;
  const lines = text.split('\n');
  return all.map((tokens, index) => {
    const line = lines[index] ?? '';
    const parts: string[] = [];
    let start = 0;
    for (let at = 0; at < tokens.length; at += 2) {
      const end = tokens[at] ?? 0;
      const name = last.classes[tokens[at + 1] ?? 0];
      if (name) parts.push(`${line.slice(start, end)}=${name}`);
      start = end;
    }
    return parts;
  });
}

describe('createShikiEngine', () => {
  it('colours code with VS Code grammars, on the Shinsa tokens', async () => {
    const lines = await tokenize('typescript', 'const a = 1;\nfunction f() {}');
    expect(lines?.[0]).toContain('const=tm-code-keyword');
    expect(lines?.[0]).toContain('1=tm-code-number');
    expect(lines?.[1]).toContain('f=tm-code-function');
  });

  it('highlights the languages markdown embeds, and its own marks', async () => {
    const lines = await tokenize('markdown', '---\ntitle: a\n---\n# Head\n**bold**\n```ts\nconst x = 1\n```');
    expect(lines?.[1]).toContain('title=tm-code-property');
    expect(lines?.[3]?.join(' ')).toContain('tm-code-tag tm-bold');
    expect(lines?.[4]?.join(' ')).toContain('bold=tm-bold');
    expect(lines?.[6]).toContain('const=tm-code-keyword');
  });

  it('reads ignore files with its own small grammar, and knows nothing of an unknown language', async () => {
    const lines = await tokenize('ignore', '# deps\n!keep\n*.log\nsrc/');
    expect(lines?.[0]).toEqual(['# deps=tm-code-comment']);
    expect(lines?.[1]).toEqual(['!=tm-code-keyword']);
    expect(await tokenize('klingon', 'x')).toBeNull();
  });

  it('colours Better Comments tags in comments only, from the marker or the margin star to the line end', async () => {
    const ts = await tokenize(
      'typescript',
      [
        'const a = 1; // ! Careful',
        '/**',
        ' * ? Why is this here',
        ' * Plain words.',
        ' */',
        '// TODO: later',
        '//// const old = 1;',
        '// * The key part',
        'const s = "// ! not a comment";',
      ].join('\n')
    );
    expect(ts?.[0]).toContain('// ! Careful=tm-code-comment-alert');
    expect(ts?.[2]).toEqual([' * =tm-code-comment', '? Why is this here=tm-code-comment-query']);
    expect(ts?.[3]).toEqual([' * Plain words.=tm-code-comment']);
    expect(ts?.[5]).toEqual(['// TODO: later=tm-code-comment-todo']);
    expect(ts?.[6]).toEqual(['//// const old = 1;=tm-code-comment-strike']);
    expect(ts?.[7]).toEqual(['// * The key part=tm-code-comment-highlight']);
    expect(ts?.[8]?.join(' ')).not.toContain('tm-code-comment');
    const python = await tokenize('python', '#!/usr/bin/env python\nx = 1  # ? Why one\n# plain');
    expect(python?.[0]?.join(' ')).not.toContain('tm-code-comment-');
    expect(python?.[1]).toContain('# ? Why one=tm-code-comment-query');
    expect(python?.[2]).toEqual(['# plain=tm-code-comment']);
  });
});
