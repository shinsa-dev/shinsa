import { describe, expect, it } from 'bun:test';
import { LanguageDescription } from '@codemirror/language';
import { requestLanguage, selectLanguageDescription } from '@/lib/code/editor/language.ts';

describe('requestLanguage', () => {
  it('loads the grammar for a file once, by its name', async () => {
    expect(selectLanguageDescription('src/app.tsx')?.name).toBe('TSX');
    expect(selectLanguageDescription('Dockerfile')?.name).toBe('Dockerfile');
    const first = requestLanguage('a/b.ts');
    expect(requestLanguage('c.ts')).toBe(first);
    expect((await first)?.language.name).toBe('typescript');
  });

  it('has no grammar for a file it does not know', async () => {
    expect(selectLanguageDescription('notes.unknownext')).toBeNull();
    expect(await requestLanguage('notes.unknownext')).toBeNull();
  });

  it('a grammar that fails to load leaves the file plain', async () => {
    const broken = LanguageDescription.of({
      name: 'Broken',
      extensions: ['brk'],
      load: () => Promise.reject(new Error('gone')),
    });
    expect(await requestLanguage('a.brk', [broken])).toBeNull();
  });
});
