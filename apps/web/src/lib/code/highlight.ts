import * as React from 'react';
import type { ThemeRegistration } from 'shiki';

export interface Token {
  content: string;
  style: React.CSSProperties | undefined;
}

const EXTENSION_LANGUAGE: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  json: 'json',
  jsonc: 'jsonc',
  md: 'markdown',
  mdx: 'mdx',
  css: 'css',
  scss: 'scss',
  html: 'html',
  vue: 'vue',
  svelte: 'svelte',
  astro: 'astro',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  swift: 'swift',
  kt: 'kotlin',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sql: 'sql',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'fish',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  graphql: 'graphql',
  gql: 'graphql',
  prisma: 'prisma',
  dockerfile: 'docker',
};

export function resolveLanguage(path: string) {
  const name = path.split('/').at(-1)?.toLowerCase() ?? '';
  if (name === 'dockerfile') return 'docker';
  const dot = name.lastIndexOf('.');
  if (dot < 0) return null;
  return EXTENSION_LANGUAGE[name.slice(dot + 1)] ?? null;
}

const FENCE_ALIASES: Record<string, string> = {
  shell: 'bash',
  console: 'bash',
  terminal: 'bash',
  text: '',
  txt: '',
  plaintext: '',
  diff: 'diff',
};

export function resolveFenceLanguage(fence: string | null) {
  if (!fence) return null;
  const name = fence.toLowerCase();
  if (name in FENCE_ALIASES) return FENCE_ALIASES[name] || null;
  return EXTENSION_LANGUAGE[name] ?? name;
}

interface Highlighted {
  code: string;
  language: string;
  tokens: Token[][] | null;
}

const CACHE_LIMIT = 200;

const MAX_HIGHLIGHTED_CHARACTERS = 400_000;

const cache = new Map<string, Promise<Token[][] | null>>();

const SCOPE_TOKENS: Record<string, string[]> = {
  keyword: [
    'keyword',
    'storage.type',
    'storage.modifier',
    'keyword.operator.new',
    'keyword.operator.expression',
    'keyword.operator.logical.python',
    'variable.language',
  ],
  string: [
    'string',
    'string.regexp',
    'constant.character',
    'punctuation.definition.string',
    'markup.inline.raw',
    'markup.fenced_code',
  ],
  number: ['constant.numeric', 'constant.language', 'support.constant'],
  comment: ['comment', 'punctuation.definition.comment', 'string.quoted.docstring'],
  function: [
    'entity.name.function',
    'support.function',
    'meta.function-call entity.name.function',
    'variable.function',
  ],
  type: [
    'entity.name.type',
    'entity.name.class',
    'entity.name.namespace',
    'entity.other.inherited-class',
    'support.type',
    'support.class',
    'storage.type.primitive',
  ],
  property: [
    'variable.other.property',
    'variable.other.object.property',
    'support.type.property-name',
    'meta.object-literal.key',
    'entity.other.attribute-name',
  ],
  tag: ['entity.name.tag', 'markup.heading', 'entity.name.section', 'punctuation.definition.heading'],
  punctuation: ['punctuation', 'meta.brace', 'keyword.operator', 'storage.type.function.arrow'],
  meta: ['meta.decorator', 'punctuation.decorator', 'meta.preprocessor', 'keyword.control.directive'],
};

export const CODE_THEME: ThemeRegistration = {
  name: 'shinsa-code',
  type: 'light',
  colors: { 'editor.foreground': 'var(--fg-4)', 'editor.background': 'transparent' },
  tokenColors: [
    ...Object.entries(SCOPE_TOKENS).map(([token, scope]) => ({
      scope,
      settings: { foreground: `var(--code-${token})` },
    })),
    { scope: 'meta.template.expression', settings: { foreground: 'var(--fg-4)' } },
    {
      scope: 'markup.underline.link',
      settings: { foreground: 'var(--code-function)', fontStyle: 'underline' },
    },
    {
      scope: ['markup.inserted', 'punctuation.definition.inserted'],
      settings: { foreground: 'var(--green-text)' },
    },
    {
      scope: ['markup.deleted', 'punctuation.definition.deleted'],
      settings: { foreground: 'var(--red-text)' },
    },
    { scope: 'invalid', settings: { foreground: 'var(--red-text)' } },
  ],
};

async function tokenize(code: string, language: string): Promise<Token[][] | null> {
  const { codeToTokens } = await import('shiki');
  const result = await codeToTokens(code, {
    lang: language as Parameters<typeof codeToTokens>[1]['lang'],
    theme: CODE_THEME,
  });
  return result.tokens.map((line) =>
    line.map((token) => ({ content: token.content, style: token.color ? { color: token.color } : undefined }))
  );
}

export function requestTokens(code: string, language: string) {
  const key = `${language}\u0000${code}`;
  const known = cache.get(key);
  if (known) return known;
  const pending = tokenize(code, language).catch(() => null);
  cache.set(key, pending);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value ?? '');
  return pending;
}

export function useTokens(code: string | null, path: string) {
  return useLanguageTokens(code, resolveLanguage(path));
}

export function useLanguageTokens(code: string | null, language: string | null) {
  const [highlighted, setHighlighted] = React.useState<Highlighted | null>(null);
  React.useEffect(() => {
    if (code === null || !language || code.length > MAX_HIGHLIGHTED_CHARACTERS) return;
    let alive = true;
    void requestTokens(code, language).then((tokens) => {
      if (alive) setHighlighted({ code, language, tokens });
    });
    return () => {
      alive = false;
    };
  }, [code, language]);
  if (!highlighted || highlighted.code !== code || highlighted.language !== language) return null;
  return highlighted.tokens;
}
