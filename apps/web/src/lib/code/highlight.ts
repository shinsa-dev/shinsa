import * as React from 'react';

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

async function tokenize(code: string, language: string): Promise<Token[][] | null> {
  const { codeToTokens } = await import('shiki');
  const result = await codeToTokens(code, {
    lang: language as Parameters<typeof codeToTokens>[1]['lang'],
    themes: { light: 'github-light', dark: 'github-dark-dimmed' },
    defaultColor: false,
  });
  return result.tokens.map((line) =>
    line.map((token) => ({
      content: token.content,
      style: token.htmlStyle as React.CSSProperties | undefined,
    }))
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
