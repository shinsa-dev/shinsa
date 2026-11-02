import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

const RAW_TEXT_ELEMENTS = /(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2>)/gi;

const REACT_NAMES: Record<string, string> = {
  accesskey: 'accessKey',
  autocomplete: 'autoComplete',
  autofocus: 'autoFocus',
  class: 'className',
  for: 'htmlFor',
  tabindex: 'tabIndex',
};

const EVENT_NAMES: Record<string, string> = {
  keydown: 'KeyDown',
  keypress: 'KeyPress',
  keyup: 'KeyUp',
  mousedown: 'MouseDown',
  mouseenter: 'MouseEnter',
  mouseleave: 'MouseLeave',
  mousemove: 'MouseMove',
  mouseout: 'MouseOut',
  mouseover: 'MouseOver',
  mouseup: 'MouseUp',
};

const HTML_RULE_PREFIXES = [
  'jsx-a11y/',
  'react/button-has-type',
  'react/jsx-no-duplicate-props',
  'shinsa/use-semantic-elements',
];

const blank = (text: string) => text.replace(/[^\n]/g, ' ');

function resolveAttributeName(name: string) {
  const lower = name.toLowerCase();
  if (REACT_NAMES[lower]) return REACT_NAMES[lower];
  const event = /^on([a-z]+)$/.exec(lower)?.[1];
  if (event) return `on${EVENT_NAMES[event] ?? `${event[0]?.toUpperCase()}${event.slice(1)}`}`;
  return name;
}

const ATTRIBUTE = /(\s+)([^\s"'>/=]+)(?:(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'>]+))?/g;

function serializeAttributes(attributes: string) {
  return attributes.replace(ATTRIBUTE, (_, space: string, name: string, equals?: string, value?: string) => {
    if (equals === undefined || value === undefined) return `${space}${resolveAttributeName(name)}`;
    const quoted = /^["']/.test(value) ? value : `"${value}"`;
    return `${space}${resolveAttributeName(name)}${equals}${quoted}`;
  });
}

function serializeTag(tag: string) {
  const [, slash, name = '', attributes = '', selfClosing] =
    /^<(\/?)([a-zA-Z][\w-]*)([\s\S]*?)(\/?)>$/.exec(tag) ?? [];
  if (slash) return VOID_ELEMENTS.has(name.toLowerCase()) ? blank(tag) : tag;
  const closes = selfClosing || VOID_ELEMENTS.has(name.toLowerCase());
  return `<${name}${serializeAttributes(attributes)}${closes ? '/' : ''}>`;
}

const TEXT_ESCAPES: Record<string, string> = { '{': '&#123;', '}': '&#125;', '>': '&gt;' };

export function serializeHtmlAsJsx(html: string) {
  const body = html
    .replace(/<!doctype[^>]*>/gi, blank)
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(RAW_TEXT_ELEMENTS, (_, open: string, _name: string, content: string, close: string) => {
      return `${open}${blank(content)}${close}`;
    })
    .replace(/<\/?[a-zA-Z][^<>]*>|[{}>]/g, (token) => TEXT_ESCAPES[token] ?? serializeTag(token));
  return `export default (<>${body}</>);\n`;
}

export function listHtmlRules(config: { rules: Record<string, unknown> }) {
  return Object.fromEntries(
    Object.entries(config.rules).filter(([rule]) =>
      HTML_RULE_PREFIXES.some((prefix) => rule.startsWith(prefix))
    )
  );
}

export function resolveHtmlReport(output: string, folder: string) {
  return Bun.stripANSI(output).replaceAll(`${folder}/`, '').replaceAll('.html.tsx', '.html');
}

export function runHtmlLint(files: string[], oxlint: string) {
  const folder = mkdtempSync(join(tmpdir(), 'shinsa-lint-html-'));
  const config = JSON.parse(readFileSync('.oxlintrc.json', 'utf8')) as { rules: Record<string, unknown> };
  try {
    writeFileSync(
      join(folder, '.oxlintrc.json'),
      JSON.stringify({
        plugins: ['react', 'jsx-a11y'],
        jsPlugins: [join(process.cwd(), 'scripts/oxlint/plugin.ts')],
        categories: { correctness: 'off' },
        rules: listHtmlRules(config),
      })
    );
    for (const file of files) {
      const target = join(folder, `${file}.tsx`);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, serializeHtmlAsJsx(readFileSync(file, 'utf8')));
    }
    const result = Bun.spawnSync([oxlint, '-c', join(folder, '.oxlintrc.json'), folder], { cwd: folder });
    const output = resolveHtmlReport(`${result.stdout.toString()}${result.stderr.toString()}`, folder);
    return { ok: result.exitCode === 0, output };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

export function lintHtml() {
  const files = Bun.spawnSync(['git', 'ls-files', '*.html']).stdout.toString().split('\n').filter(Boolean);
  const { ok, output } = runHtmlLint(files, join(process.cwd(), 'node_modules/.bin/oxlint'));
  process.stdout.write(output);
  return ok ? 0 : 1;
}

if (import.meta.main) process.exit(lintHtml());
