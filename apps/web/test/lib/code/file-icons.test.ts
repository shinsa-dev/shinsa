import { describe, expect, it } from 'bun:test';
import { ICON_NAMES } from '@shinsa/ui/components/icon';
import { resolveFileIcon, resolveFolderIcon } from '@/lib/code/file-icons.ts';

describe('resolveFileIcon', () => {
  it('maps languages by extension, in any folder and any case', () => {
    expect(resolveFileIcon('src/app.ts')).toBe('IconFileTypeTypescript');
    expect(resolveFileIcon('src/App.TSX')).toBe('IconFileTypeReact');
    expect(resolveFileIcon('index.mjs')).toBe('IconFileTypeJavascript');
    expect(resolveFileIcon('data/config.json')).toBe('IconFileTypeJson');
    expect(resolveFileIcon('docs/design.md')).toBe('IconFileTypeMarkdown');
    expect(resolveFileIcon('app.css')).toBe('IconFileTypeCss');
    expect(resolveFileIcon('index.html')).toBe('IconFileTypeHtml');
    expect(resolveFileIcon('.github/workflows/ci.yml')).toBe('IconFileTypeYaml');
    expect(resolveFileIcon('scripts/run.sh')).toBe('IconFileTypeShell');
    expect(resolveFileIcon('main.py')).toBe('IconFileTypePython');
    expect(resolveFileIcon('main.go')).toBe('IconFileTypeGo');
    expect(resolveFileIcon('lib.rs')).toBe('IconFileTypeRust');
    expect(resolveFileIcon('schema.sql')).toBe('IconFileTypeDatabase');
    expect(resolveFileIcon('logo.svg')).toBe('IconFileTypeSvg');
    expect(resolveFileIcon('docs/images/review.png')).toBe('IconFileTypeImage');
    expect(resolveFileIcon('font.woff2')).toBe('IconText1');
    expect(resolveFileIcon('build.tar.gz')).toBe('IconFileTypeArchive');
    expect(resolveFileIcon('app.rb')).toBe('IconCodeBrackets');
  });

  it('knows well-known files by name before their extension', () => {
    expect(resolveFileIcon('package.json')).toBe('IconFileTypeNpm');
    expect(resolveFileIcon('apps/web/package.json')).toBe('IconFileTypeNpm');
    expect(resolveFileIcon('bun.lock')).toBe('IconLock');
    expect(resolveFileIcon('Cargo.lock')).toBe('IconLock');
    expect(resolveFileIcon('tsconfig.json')).toBe('IconFileTypeTsconfig');
    expect(resolveFileIcon('apps/web/tsconfig.build.json')).toBe('IconFileTypeTsconfig');
    expect(resolveFileIcon('Dockerfile')).toBe('IconFileTypeDocker');
    expect(resolveFileIcon('Dockerfile.dev')).toBe('IconFileTypeDocker');
    expect(resolveFileIcon('.gitignore')).toBe('IconFileTypeGit');
    expect(resolveFileIcon('README.md')).toBe('IconFileTypeReadme');
    expect(resolveFileIcon('LICENSE')).toBe('IconFileTypeLicense');
    expect(resolveFileIcon('CHANGELOG.md')).toBe('IconHistory');
    expect(resolveFileIcon('CLAUDE.md')).toBe('IconFileTypeClaude');
    expect(resolveFileIcon('apps/api/AGENTS.md')).toBe('IconFileTypeAgents');
    expect(resolveFileIcon('.husky/pre-commit')).toBe('IconFileTypeShell');
    expect(resolveFileIcon('.husky/_/h')).toBe('IconFileText');
    expect(resolveFileIcon('.env.local')).toBe('IconFileTypeEnv');
    expect(resolveFileIcon('biome.json')).toBe('IconSettingsGear1');
    expect(resolveFileIcon('vite.config.ts')).toBe('IconSettingsGear1');
    expect(resolveFileIcon('.prettierrc')).toBe('IconSettingsGear1');
  });

  it('marks tests apart from the code they test', () => {
    expect(resolveFileIcon('test/lib/a.test.ts')).toBe('IconFileTypeTest');
    expect(resolveFileIcon('b.spec.tsx')).toBe('IconFileTypeTest');
  });

  it('falls back to a plain file for anything else', () => {
    expect(resolveFileIcon('notes.txt')).toBe('IconFileText');
    expect(resolveFileIcon('Makefile.backup')).toBe('IconFileText');
    expect(resolveFileIcon('.hidden')).toBe('IconFileText');
    expect(resolveFileIcon('noextension')).toBe('IconFileText');
  });

  it('only ever names an icon the kit carries', () => {
    const names = new Set<string>(ICON_NAMES);
    for (const path of [
      'a.ts',
      'package.json',
      'x.unknown',
      'README',
      'a.test.js',
      'z.mp3',
      'y.mov',
      'w.pdf',
      'v.csv',
    ])
      expect(names.has(resolveFileIcon(path))).toBe(true);
  });
});

describe('resolveFolderIcon', () => {
  it('opens and closes, and tones the folders that say what they hold', () => {
    expect(resolveFolderIcon('apps/web', false)).toBe('IconFolder1Filled');
    expect(resolveFolderIcon('apps/web', true)).toBe('IconFolderOpen');
    expect(resolveFolderIcon('apps/web/src', false)).toBe('IconFolderSource');
    expect(resolveFolderIcon('apps/web/src', true)).toBe('IconFolderOpenSource');
    expect(resolveFolderIcon('test', true)).toBe('IconFolderOpenTest');
    expect(resolveFolderIcon('docs', false)).toBe('IconFolderDocs');
    expect(resolveFolderIcon('scripts', false)).toBe('IconFolderScripts');
    expect(resolveFolderIcon('public', false)).toBe('IconFolderAssets');
    expect(resolveFolderIcon('.github', false)).toBe('IconFolderGit');
  });
});
