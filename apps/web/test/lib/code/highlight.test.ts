import { describe, expect, it } from 'bun:test';
import { renderHook, waitFor } from '@testing-library/react';
import {
  requestTokens,
  resolveFenceLanguage,
  resolveLanguage,
  resolveTaggedTokens,
  useLanguageTokens,
  useTokens,
} from '@/lib/code/highlight.ts';

describe('resolveLanguage', () => {
  it('picks the language from the file extension, in any case', () => {
    expect(resolveLanguage('apps/web/src/main.ts')).toBe('typescript');
    expect(resolveLanguage('src/App.TSX')).toBe('tsx');
    expect(resolveLanguage('config/settings.yml')).toBe('yaml');
    expect(resolveLanguage('scripts/setup.zsh')).toBe('shellscript');
  });

  it('recognises Dockerfiles by name and by extension', () => {
    expect(resolveLanguage('Dockerfile')).toBe('docker');
    expect(resolveLanguage('deploy/api.dockerfile')).toBe('docker');
  });

  it('leaves unknown extensions plain', () => {
    expect(resolveLanguage('notes.unknown')).toBeNull();
    expect(resolveLanguage('')).toBeNull();
  });

  it('knows files without an extension by name, and leaves the rest plain', () => {
    expect(resolveLanguage('Makefile')).toBe('make');
    expect(resolveLanguage('bin/go')).toBeNull();
    expect(resolveLanguage('include/c')).toBeNull();
  });
});

describe('resolveFenceLanguage', () => {
  it('reads a fence written as an extension or as a language name', () => {
    expect(resolveFenceLanguage('ts')).toBe('typescript');
    expect(resolveFenceLanguage('TypeScript')).toBe('typescript');
    expect(resolveFenceLanguage('python')).toBe('python');
    expect(resolveFenceLanguage('Dockerfile')).toBe('docker');
  });

  it('reads terminal fences as shell scripts and keeps diffs', () => {
    expect(resolveFenceLanguage('shell')).toBe('shellscript');
    expect(resolveFenceLanguage('console')).toBe('shellscript');
    expect(resolveFenceLanguage('diff')).toBe('diff');
  });

  it('leaves plain text and missing fences unhighlighted', () => {
    expect(resolveFenceLanguage('text')).toBeNull();
    expect(resolveFenceLanguage('plaintext')).toBeNull();
    expect(resolveFenceLanguage(null)).toBeNull();
    expect(resolveFenceLanguage('')).toBeNull();
  });
});

describe('requestTokens', () => {
  it('colours each line from the --code-* tokens the editor reads, so both themes follow', async () => {
    const tokens = await requestTokens('const a = 1;\nlet b', 'typescript');
    expect(tokens).toHaveLength(2);
    expect(tokens?.[0]?.map((token) => token.content).join('')).toBe('const a = 1;');
    expect(tokens?.[0]?.map((token) => [token.content, token.style?.color])).toEqual([
      ['const', 'var(--code-keyword)'],
      [' a ', 'var(--fg-4)'],
      ['=', 'var(--code-punctuation)'],
      [' ', 'var(--fg-4)'],
      ['1', 'var(--code-number)'],
      [';', 'var(--code-punctuation)'],
    ]);
  });

  it('marks added and removed lines of a diff in the tones, and links underlined', async () => {
    const diff = await requestTokens('-old\n+new', 'diff');
    expect(diff?.map((line) => line.map((token) => token.style?.color))).toEqual([
      ['var(--red-text)'],
      ['var(--green-text)'],
    ]);
    const markdown = await requestTokens('[docs](https://example.com)', 'markdown');
    expect(markdown?.[0]?.find((token) => token.content === 'https://example.com')?.style?.color).toBe(
      'var(--code-function)'
    );
  });

  it('colours Better Comments tags as the editor does, keeping the margin star of a doc comment', async () => {
    const tokens = await requestTokens(
      ['// ! Careful', '/**', ' * ! @param name The name', ' * TODO cover it', ' */', '//// old'].join('\n'),
      'typescript'
    );
    const read = (line: number) => tokens?.[line]?.map((token) => [token.content, token.style?.color]);
    expect(read(0)).toEqual([['// ! Careful', 'var(--code-comment-alert)']]);
    expect(read(2)).toEqual([
      [' * ', 'var(--code-comment)'],
      ['! @param name The name', 'var(--code-comment-alert)'],
    ]);
    expect(read(3)).toEqual([
      [' * ', 'var(--code-comment)'],
      ['TODO cover it', 'var(--code-comment-todo)'],
    ]);
    expect(tokens?.[5]?.[0]?.style).toEqual({
      color: 'var(--code-comment-strike)',
      textDecoration: 'line-through',
    });
    expect(
      resolveTaggedTokens([[{ content: '/*' }], [{ content: ' x ', color: 'var(--code-comment)' }]])
    ).toEqual([
      [{ content: '/*', style: undefined }],
      [{ content: ' x ', style: { color: 'var(--code-comment)' } }],
    ]);
  });

  it('reuses the same work for the same code and language', () => {
    const first = requestTokens('let shared = 1;', 'typescript');
    expect(requestTokens('let shared = 1;', 'typescript')).toBe(first);
    expect(requestTokens('let shared = 1;', 'javascript')).not.toBe(first);
  });

  it('gives no tokens for a language it cannot load', async () => {
    expect(await requestTokens('x', 'not-a-language')).toBeNull();
  });

  it('forgets the oldest code once it holds two hundred entries', async () => {
    const oldest = requestTokens('oldest', 'not-a-language');
    const kept = requestTokens('kept', 'not-a-language');
    for (let index = 0; index < 199; index += 1) void requestTokens(`filler ${index}`, 'not-a-language');
    expect(requestTokens('kept', 'not-a-language')).toBe(kept);
    expect(requestTokens('oldest', 'not-a-language')).not.toBe(oldest);
    await oldest;
  });
});

describe('useLanguageTokens', () => {
  it('returns tokens once highlighting finishes', async () => {
    const { result } = renderHook(() => useLanguageTokens('const ready = true;', 'typescript'));
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current?.[0]?.[0]?.content).toBe('const'));
  });

  it('drops stale tokens the moment the code changes', async () => {
    const { result, rerender } = renderHook(({ code }) => useLanguageTokens(code, 'typescript'), {
      initialProps: { code: 'const first = 1;' },
    });
    await waitFor(() => expect(result.current).not.toBeNull());
    rerender({ code: 'let second = 2;' });
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current?.[0]?.[0]?.content).toBe('let'));
  });

  it('highlights nothing without code, without a language or for very large code', async () => {
    const empty = renderHook(() => useLanguageTokens(null, 'typescript'));
    const plain = renderHook(() => useLanguageTokens('const a = 1;', null));
    const huge = renderHook(() => useLanguageTokens('x'.repeat(400_001), 'typescript'));
    const highlighted = renderHook(() => useLanguageTokens('const a = 1;', 'typescript'));
    await waitFor(() => expect(highlighted.result.current).not.toBeNull());
    expect(empty.result.current).toBeNull();
    expect(plain.result.current).toBeNull();
    expect(huge.result.current).toBeNull();
  });

  it('ignores a result that arrives after it was unmounted', async () => {
    const code = 'const late = 1;';
    const { result, unmount } = renderHook(() => useLanguageTokens(code, 'typescript'));
    unmount();
    await requestTokens(code, 'typescript');
    expect(result.current).toBeNull();
  });
});

describe('useTokens', () => {
  it('picks the language from the path', async () => {
    const { result } = renderHook(() => useTokens('fn main() {}', 'src/main.rs'));
    await waitFor(() => expect(result.current?.[0]?.[0]?.content).toBe('fn'));
  });
});
