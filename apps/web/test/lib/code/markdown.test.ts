import { describe, expect, it } from 'bun:test';
import { isMarkdownPath, resolveFileLink, resolveImagePath } from '@/lib/code/markdown.ts';

describe('Markdown files', () => {
  it('knows a Markdown file by its extension, in any case', () => {
    expect(['README.md', 'docs/guide.MDX', 'notes.markdown'].map(isMarkdownPath)).toEqual([true, true, true]);
    expect(['src/main.ts', 'md', 'README'].map(isMarkdownPath)).toEqual([false, false, false]);
  });

  it('resolves a link against the folder of the file it is in', () => {
    expect(resolveFileLink('docs/guide.md', 'setup.md')).toEqual({ path: 'docs/setup.md', line: null });
    expect(resolveFileLink('docs/guide.md', './api/index.md')).toEqual({
      path: 'docs/api/index.md',
      line: null,
    });
    expect(resolveFileLink('docs/guide.md', '../src/main.ts#L12')).toEqual({ path: 'src/main.ts', line: 12 });
    expect(resolveFileLink('docs/guide.md', '/LICENSE?plain=1#L3-L9')).toEqual({ path: 'LICENSE', line: 3 });
    expect(resolveFileLink('README.md', 'My%20Notes.md#intro')).toEqual({ path: 'My Notes.md', line: null });
  });

  it('leaves links to the web, anchors and paths outside the project alone', () => {
    for (const href of [
      undefined,
      '',
      'https://shinsa.dev',
      'mailto:me@example.com',
      '//cdn.example.com/a.png',
      '#install',
      '../outside.md',
      '?tab=1',
      '.',
    ]) {
      expect(resolveFileLink('README.md', href)).toBeNull();
    }
  });

  it('resolves an image in the project, and leaves one on the web alone', () => {
    expect(resolveImagePath('docs/guide.md', '../assets/logo.png')).toBe('assets/logo.png');
    expect(resolveImagePath('docs/guide.md', 'https://example.com/logo.png')).toBeNull();
    expect(resolveImagePath('docs/guide.md', undefined)).toBeNull();
  });
});
