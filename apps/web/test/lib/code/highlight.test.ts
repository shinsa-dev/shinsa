import { describe, expect, it } from 'bun:test';
import { renderHook, waitFor } from '@testing-library/react';
import {
  requestTokens,
  resolveFenceLanguage,
  resolveLanguage,
  useLanguageTokens,
  useTokens,
} from '@/lib/code/highlight.ts';

describe('resolveLanguage', () => {
  it('picks the language from the file extension, in any case', () => {
    expect(resolveLanguage('apps/web/src/main.ts')).toBe('typescript');
    expect(resolveLanguage('src/App.TSX')).toBe('tsx');
    expect(resolveLanguage('config/settings.yml')).toBe('yaml');
    expect(resolveLanguage('scripts/setup.zsh')).toBe('bash');
  });

  it('recognises Dockerfiles by name and by extension', () => {
    expect(resolveLanguage('Dockerfile')).toBe('docker');
    expect(resolveLanguage('deploy/api.dockerfile')).toBe('docker');
  });

  it('leaves unknown extensions plain', () => {
    expect(resolveLanguage('notes.unknown')).toBeNull();
    expect(resolveLanguage('')).toBeNull();
  });

  it('leaves files without an extension plain, even when the name looks like one', () => {
    expect(resolveLanguage('Makefile')).toBeNull();
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

  it('reads terminal fences as bash and keeps diffs', () => {
    expect(resolveFenceLanguage('shell')).toBe('bash');
    expect(resolveFenceLanguage('console')).toBe('bash');
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
  it('highlights each line with a light and a dark colour', async () => {
    const tokens = await requestTokens('const a = 1;\nlet b', 'typescript');
    expect(tokens).toHaveLength(2);
    expect(tokens?.[0]?.map((token) => token.content).join('')).toBe('const a = 1;');
    expect(tokens?.[0]?.[0]?.style as Record<string, string>).toEqual({
      '--shiki-light': '#D73A49',
      '--shiki-dark': '#F47067',
    });
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
