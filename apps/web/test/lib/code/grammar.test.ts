import { describe, expect, it } from 'bun:test';
import {
  CODE_THEME,
  listEmbeddedGrammars,
  listThemeColors,
  resolveColorClass,
  resolveFenceGrammar,
  resolveGrammar,
  resolveTokenClass,
} from '@/lib/code/grammar.ts';

describe('resolveGrammar', () => {
  it('reads the extension, in any case', () => {
    expect(resolveGrammar('apps/web/src/main.ts')).toBe('typescript');
    expect(resolveGrammar('src/App.TSX')).toBe('tsx');
    expect(resolveGrammar('schema.prisma')).toBe('prisma');
    expect(resolveGrammar('api/v1.proto')).toBe('proto');
    expect(resolveGrammar('src/pages/index.astro')).toBe('astro');
    expect(resolveGrammar('src/App.svelte')).toBe('svelte');
    expect(resolveGrammar('docs/intro.mdx')).toBe('mdx');
    expect(resolveGrammar('infra/main.tf')).toBe('terraform');
    expect(resolveGrammar('Cargo.toml')).toBe('toml');
    expect(resolveGrammar('scripts/setup.zsh')).toBe('shellscript');
    expect(resolveGrammar('production.env')).toBe('dotenv');
  });

  it('knows files by name the way VS Code does', () => {
    expect(resolveGrammar('Dockerfile')).toBe('docker');
    expect(resolveGrammar('deploy/Dockerfile.prod')).toBe('docker');
    expect(resolveGrammar('Makefile')).toBe('make');
    expect(resolveGrammar('.git/COMMIT_EDITMSG')).toBe('git-commit');
    expect(resolveGrammar('.git/rebase-merge/git-rebase-todo')).toBe('git-rebase');
    expect(resolveGrammar('.gitignore')).toBe('ignore');
    expect(resolveGrammar('web/.dockerignore')).toBe('ignore');
    expect(resolveGrammar('.prettierignore')).toBe('ignore');
    expect(resolveGrammar('.env')).toBe('dotenv');
    expect(resolveGrammar('apps/api/.env.local.example')).toBe('dotenv');
    expect(resolveGrammar('tsconfig.json')).toBe('jsonc');
    expect(resolveGrammar('tsconfig.build.json')).toBe('jsonc');
    expect(resolveGrammar('shinsa.code-workspace')).toBe('jsonc');
    expect(resolveGrammar('Cargo.lock')).toBe('toml');
    expect(resolveGrammar('.github/CODEOWNERS')).toBe('codeowners');
  });

  it('knows files by where they sit', () => {
    expect(resolveGrammar('.husky/pre-commit')).toBe('shellscript');
    expect(resolveGrammar('web/.husky/commit-msg')).toBe('shellscript');
    expect(resolveGrammar('.husky/_/husky.sh')).toBe('shellscript');
    expect(resolveGrammar('.husky/_/h')).toBeNull();
    expect(resolveGrammar('.git/hooks/pre-push')).toBe('shellscript');
    expect(resolveGrammar('.git/info/exclude')).toBe('ignore');
    expect(resolveGrammar('.vscode/settings.json')).toBe('jsonc');
    expect(resolveGrammar('.devcontainer/devcontainer.json')).toBe('jsonc');
  });

  it('falls back to the shebang, and leaves the rest plain', () => {
    expect(resolveGrammar('bin/run', '#!/usr/bin/env bun')).toBe('typescript');
    expect(resolveGrammar('bin/run', '#!/usr/bin/env node')).toBe('javascript');
    expect(resolveGrammar('bin/run', '#!/usr/bin/python3')).toBe('python');
    expect(resolveGrammar('bin/run', '#!/bin/sh')).toBe('shellscript');
    expect(resolveGrammar('bin/run', '#!/usr/bin/env bash')).toBe('shellscript');
    expect(resolveGrammar('bin/run', '#!/usr/bin/env cobol')).toBeNull();
    expect(resolveGrammar('bin/run', 'echo')).toBeNull();
    expect(resolveGrammar('notes.unknown')).toBeNull();
    expect(resolveGrammar('LICENSE')).toBeNull();
  });
});

describe('resolveFenceGrammar', () => {
  it('reads a fence written as an extension, a language or an alias', () => {
    expect(resolveFenceGrammar('ts')).toBe('typescript');
    expect(resolveFenceGrammar('TypeScript')).toBe('typescript');
    expect(resolveFenceGrammar('shell')).toBe('shellscript');
    expect(resolveFenceGrammar('dockerfile')).toBe('docker');
    expect(resolveFenceGrammar('gitignore')).toBe('ignore');
    expect(resolveFenceGrammar('text')).toBeNull();
    expect(resolveFenceGrammar(null)).toBeNull();
    expect(resolveFenceGrammar('')).toBeNull();
  });
});

describe('listEmbeddedGrammars', () => {
  it('lists the languages a markdown file embeds, front matter included', () => {
    const text = '---\ntitle: a\n---\n```ts\nx\n```\n~~~ {.py}\ny\n~~~\n```text\nz\n```\n   ```sh\n';
    expect(listEmbeddedGrammars(text)).toEqual(['typescript', 'python', 'shellscript', 'yaml']);
    expect(listEmbeddedGrammars('+++\na = 1\n+++\n')).toEqual(['toml']);
    expect(listEmbeddedGrammars('# plain')).toEqual([]);
  });
});

describe('token classes', () => {
  it('names a class for each theme colour and each font style', () => {
    expect(resolveColorClass('var(--code-keyword)')).toBe('tm-code-keyword');
    expect(resolveColorClass('#ff0000')).toBeNull();
    expect(resolveTokenClass('var(--code-tag)', 2)).toBe('tm-code-tag tm-bold');
    expect(resolveTokenClass(undefined, 1 | 4 | 8)).toBe('tm-italic tm-underline tm-strike');
    expect(resolveTokenClass(undefined, 0)).toBe('');
  });

  it('lists every colour the theme uses once', () => {
    const colors = listThemeColors();
    expect(colors).toContain('var(--code-keyword)');
    expect(colors).toContain('var(--red-text)');
    expect(new Set(colors).size).toBe(colors.length);
    expect(CODE_THEME.name).toBe('shinsa-code');
  });
});
