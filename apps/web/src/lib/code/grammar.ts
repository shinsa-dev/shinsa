import type { ThemeRegistration } from 'shiki';

const EXTENSION_GRAMMARS: Record<string, string> = {
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
  json5: 'json5',
  jsonl: 'jsonl',
  md: 'markdown',
  markdown: 'markdown',
  mdown: 'markdown',
  mkd: 'markdown',
  mdx: 'mdx',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  styl: 'stylus',
  pcss: 'postcss',
  postcss: 'postcss',
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  vue: 'vue',
  svelte: 'svelte',
  astro: 'astro',
  py: 'python',
  pyi: 'python',
  pyw: 'python',
  rb: 'ruby',
  rake: 'ruby',
  gemspec: 'ruby',
  go: 'go',
  rs: 'rust',
  swift: 'swift',
  kt: 'kotlin',
  kts: 'kotlin',
  java: 'java',
  groovy: 'groovy',
  gradle: 'groovy',
  scala: 'scala',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  hxx: 'cpp',
  m: 'objective-c',
  mm: 'objective-cpp',
  cs: 'csharp',
  fs: 'fsharp',
  php: 'php',
  sql: 'sql',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  ksh: 'shellscript',
  fish: 'fish',
  ps1: 'powershell',
  psm1: 'powershell',
  bat: 'bat',
  cmd: 'bat',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  cfg: 'ini',
  properties: 'properties',
  xml: 'xml',
  plist: 'xml',
  svg: 'xml',
  xsd: 'xml',
  xsl: 'xsl',
  graphql: 'graphql',
  gql: 'graphql',
  prisma: 'prisma',
  proto: 'proto',
  tf: 'terraform',
  tfvars: 'terraform',
  hcl: 'hcl',
  dart: 'dart',
  lua: 'lua',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  hs: 'haskell',
  clj: 'clojure',
  cljs: 'clojure',
  edn: 'clojure',
  elm: 'elm',
  zig: 'zig',
  nim: 'nim',
  r: 'r',
  jl: 'julia',
  tex: 'latex',
  sty: 'latex',
  cls: 'latex',
  bib: 'bibtex',
  diff: 'diff',
  patch: 'diff',
  dockerfile: 'docker',
  containerfile: 'docker',
  mk: 'make',
  nix: 'nix',
  vim: 'viml',
  csv: 'csv',
  tsv: 'tsv',
  log: 'log',
  http: 'http',
  glsl: 'glsl',
  frag: 'glsl',
  vert: 'glsl',
  wgsl: 'wgsl',
  hlsl: 'hlsl',
  sol: 'solidity',
  ml: 'ocaml',
  env: 'dotenv',
};

const FILE_NAME_GRAMMARS: Record<string, string> = {
  dockerfile: 'docker',
  containerfile: 'docker',
  makefile: 'make',
  gnumakefile: 'make',
  commit_editmsg: 'git-commit',
  merge_msg: 'git-commit',
  tag_editmsg: 'git-commit',
  squash_msg: 'git-commit',
  'git-rebase-todo': 'git-rebase',
  codeowners: 'codeowners',
  '.gitmodules': 'ini',
  '.gitconfig': 'ini',
  '.editorconfig': 'ini',
  '.npmrc': 'ini',
  '.bashrc': 'shellscript',
  '.bash_profile': 'shellscript',
  '.bash_aliases': 'shellscript',
  '.profile': 'shellscript',
  '.zshrc': 'shellscript',
  '.zshenv': 'shellscript',
  '.zprofile': 'shellscript',
  '.envrc': 'shellscript',
  'tsconfig.json': 'jsonc',
  'jsconfig.json': 'jsonc',
  '.eslintrc': 'jsonc',
  '.eslintrc.json': 'jsonc',
  '.babelrc': 'jsonc',
  '.swcrc': 'jsonc',
  '.jshintrc': 'jsonc',
  'devcontainer.json': 'jsonc',
  'bun.lock': 'jsonc',
  '.prettierrc': 'json',
  'cargo.lock': 'toml',
  pipfile: 'toml',
  'poetry.lock': 'toml',
  'uv.lock': 'toml',
  gemfile: 'ruby',
  rakefile: 'ruby',
  podfile: 'ruby',
  fastfile: 'ruby',
  brewfile: 'ruby',
  vagrantfile: 'ruby',
  justfile: 'just',
  jenkinsfile: 'groovy',
  'cmakelists.txt': 'cmake',
  'nginx.conf': 'nginx',
  '.htaccess': 'apache',
};

const NAME_PATTERNS: [RegExp, string][] = [
  [/^\.env(\..+)?$/, 'dotenv'],
  [/^(dockerfile|containerfile)\..+$/, 'docker'],
  [/^\.[\w.-]*ignore$/, 'ignore'],
  [/^(tsconfig|jsconfig)\..+\.json$/, 'jsonc'],
  [/\.code-workspace$/, 'jsonc'],
];

const PATH_PATTERNS: [RegExp, string][] = [
  [/(^|\/)\.husky\/[^/_.][^/.]*$/, 'shellscript'],
  [/(^|\/)\.git\/hooks\/[^/.]+$/, 'shellscript'],
  [/(^|\/)\.git\/info\/exclude$/, 'ignore'],
  [/(^|\/)\.vscode\/[^/]+\.json$/, 'jsonc'],
  [/(^|\/)\.devcontainer\/[^/]+\.json$/, 'jsonc'],
];

const SHEBANGS: [RegExp, string][] = [
  [/\b(bun|deno|tsx|ts-node)\b/, 'typescript'],
  [/\bnode\b/, 'javascript'],
  [/\bpython[\d.]*\b/, 'python'],
  [/\b(ba|z|k|da|a)?sh\b/, 'shellscript'],
  [/\bfish\b/, 'fish'],
  [/\bruby\b/, 'ruby'],
  [/\bperl\b/, 'perl'],
  [/\bphp\b/, 'php'],
  [/\blua\b/, 'lua'],
  [/\bmake\b/, 'make'],
];

const FENCE_ALIASES: Record<string, string> = {
  shell: 'shellscript',
  console: 'shellscript',
  terminal: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  sh: 'shellscript',
  text: '',
  txt: '',
  plaintext: '',
  plain: '',
  diff: 'diff',
  yml: 'yaml',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  kt: 'kotlin',
  'c++': 'cpp',
  'c#': 'csharp',
  docker: 'docker',
  dockerfile: 'docker',
  make: 'make',
  makefile: 'make',
  dotenv: 'dotenv',
  env: 'dotenv',
  ignore: 'ignore',
  gitignore: 'ignore',
  'git-commit': 'git-commit',
  'git-rebase': 'git-rebase',
};

export function resolveGrammar(path: string, firstLine = ''): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  const known = FILE_NAME_GRAMMARS[name] ?? NAME_PATTERNS.find(([pattern]) => pattern.test(name))?.[1];
  if (known) return known;
  const byPath = PATH_PATTERNS.find(([pattern]) => pattern.test(path))?.[1];
  if (byPath) return byPath;
  const dot = name.lastIndexOf('.');
  const byExtension = dot >= 0 ? EXTENSION_GRAMMARS[name.slice(dot + 1)] : undefined;
  if (byExtension) return byExtension;
  if (!firstLine.startsWith('#!')) return null;
  return SHEBANGS.find(([pattern]) => pattern.test(firstLine))?.[1] ?? null;
}

export function resolveFenceGrammar(fence: string | null) {
  if (!fence) return null;
  const name = fence.toLowerCase();
  if (name in FENCE_ALIASES) return FENCE_ALIASES[name] || null;
  return EXTENSION_GRAMMARS[name] ?? name;
}

const FENCE = /^ {0,3}(?:`{3,}|~{3,})[ \t]*\{?\.?([\w#+-]+)/gm;

export function listEmbeddedGrammars(text: string) {
  const found = new Set<string>();
  for (const match of text.matchAll(FENCE)) {
    const grammar = resolveFenceGrammar(match[1] ?? null);
    if (grammar) found.add(grammar);
  }
  if (/^---\r?\n/.test(text)) found.add('yaml');
  if (/^\+\+\+\r?\n/.test(text)) found.add('toml');
  return [...found];
}

export const IGNORE_GRAMMAR = {
  name: 'ignore',
  scopeName: 'source.ignore',
  patterns: [
    { match: '^\\s*#.*$', name: 'comment.line.number-sign.ignore' },
    { match: '^\\s*(!)', captures: { '1': { name: 'keyword.operator.negation.ignore' } } },
    { match: '\\\\.', name: 'constant.character.escape.ignore' },
    { match: '\\*\\*|[*?]', name: 'keyword.operator.glob.ignore' },
    { match: '\\[[^\\]]*\\]', name: 'constant.character.class.ignore' },
    { match: '/', name: 'punctuation.separator.path.ignore' },
  ],
};

const SCOPE_TOKENS: Record<string, string[]> = {
  keyword: [
    'keyword',
    'storage.type',
    'storage.modifier',
    'keyword.operator.new',
    'keyword.operator.expression',
    'keyword.operator.logical.python',
    'keyword.operator.negation.ignore',
    'keyword.operator.glob.ignore',
    'variable.language',
  ],
  string: [
    'string',
    'string.regexp',
    'constant.character',
    'punctuation.definition.string',
    'markup.inline.raw',
    'markup.raw',
    'property.value.dotenv',
  ],
  number: [
    'constant.numeric',
    'constant.language',
    'support.constant',
    'constant.character.escape',
    'constant.other.color',
    'constant.other.reference.link.markdown',
  ],
  comment: [
    'comment',
    'punctuation.definition.comment',
    'string.quoted.docstring',
    'markup.quote',
    'punctuation.definition.quote.begin.markdown',
  ],
  function: [
    'entity.name.function',
    'support.function',
    'meta.function-call entity.name.function',
    'variable.function',
    'string.other.link',
    'markup.underline.link',
  ],
  type: [
    'entity.name.type',
    'entity.name.class',
    'entity.name.namespace',
    'entity.other.inherited-class',
    'support.type',
    'support.class',
    'support.class.component',
    'storage.type.primitive',
    'entity.name.type.class',
  ],
  property: [
    'variable.other.property',
    'variable.other.object.property',
    'support.type.property-name',
    'support.variable.property',
    'meta.object-literal.key',
    'entity.other.attribute-name',
    'variable.key.dotenv',
    'variable.other.key',
    'punctuation.definition.list.begin.markdown',
    'entity.name.tag.yaml',
  ],
  tag: [
    'entity.name.tag',
    'markup.heading',
    'entity.name.section',
    'punctuation.definition.heading',
    'heading.1.markdown',
    'heading.2.markdown',
    'heading.3.markdown',
    'heading.4.markdown',
    'heading.5.markdown',
    'heading.6.markdown',
  ],
  punctuation: [
    'punctuation',
    'meta.brace',
    'keyword.operator',
    'storage.type.function.arrow',
    'punctuation.separator.path.ignore',
  ],
  meta: [
    'meta.decorator',
    'punctuation.decorator',
    'meta.preprocessor',
    'keyword.control.directive',
    'fenced_code.block.language',
    'entity.other.attribute-name.pseudo-class',
  ],
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
    { scope: ['meta.embedded', 'source.embedded'], settings: { foreground: 'var(--fg-4)' } },
    {
      scope: ['markup.underline.link', 'string.other.link.title.markdown'],
      settings: { foreground: 'var(--code-function)', fontStyle: 'underline' },
    },
    { scope: ['markup.heading', 'entity.name.section'], settings: { fontStyle: 'bold' } },
    { scope: 'markup.bold', settings: { fontStyle: 'bold' } },
    { scope: 'markup.italic', settings: { fontStyle: 'italic' } },
    { scope: 'markup.strikethrough', settings: { fontStyle: 'strikethrough' } },
    { scope: 'markup.quote', settings: { fontStyle: 'italic' } },
    {
      scope: ['markup.inserted', 'punctuation.definition.inserted'],
      settings: { foreground: 'var(--green-text)' },
    },
    {
      scope: ['markup.deleted', 'punctuation.definition.deleted'],
      settings: { foreground: 'var(--red-text)' },
    },
    {
      scope: ['markup.changed', 'punctuation.definition.changed'],
      settings: { foreground: 'var(--amber-text)' },
    },
    { scope: 'invalid', settings: { foreground: 'var(--red-text)' } },
  ],
};

const FONT_STYLE = { italic: 1, bold: 2, underline: 4, strikethrough: 8 } as const;

export function resolveColorClass(color: string) {
  const name = /^var\(--([\w-]+)\)$/.exec(color)?.[1];
  return name ? `tm-${name}` : null;
}

export function resolveTokenClass(color: string | undefined, fontStyle: number) {
  const classes = [
    color ? resolveColorClass(color) : null,
    fontStyle & FONT_STYLE.italic ? 'tm-italic' : null,
    fontStyle & FONT_STYLE.bold ? 'tm-bold' : null,
    fontStyle & FONT_STYLE.underline ? 'tm-underline' : null,
    fontStyle & FONT_STYLE.strikethrough ? 'tm-strike' : null,
  ];
  return classes.filter((name) => name !== null).join(' ');
}

export function listThemeColors() {
  const colors = new Set<string>();
  for (const rule of CODE_THEME.tokenColors ?? []) {
    if (rule.settings.foreground) colors.add(rule.settings.foreground);
  }
  return [...colors];
}
