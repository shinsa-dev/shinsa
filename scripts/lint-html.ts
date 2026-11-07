import { dirname, join } from 'node:path';
import { BunRuntime } from '@effect/platform-bun';
import { Console, Effect, FileSystem, Schema } from 'effect';
import { CommandLayer } from './kit/command/index.ts';
import { Command } from './kit/command/service.ts';
import { reportFailure } from './kit/script.ts';

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

const OxlintConfig = Schema.fromJsonString(
  Schema.Struct({ rules: Schema.Record(Schema.String, Schema.Unknown) })
);

const decodeOxlintConfig = Schema.decodeUnknownEffect(OxlintConfig);

export class HtmlLintFailed extends Schema.TaggedError<HtmlLintFailed, { readonly brand: unique symbol }>()(
  'HtmlLintFailed',
  { message: Schema.String }
) {}

export const runHtmlLint = Effect.fn('HtmlLint.run')(
  function* (files: readonly string[], oxlint: string) {
    const fs = yield* FileSystem.FileSystem;
    const command = yield* Command;
    const folder = yield* fs.makeTempDirectoryScoped({ prefix: 'shinsa-lint-html-' });
    const config = yield* decodeOxlintConfig(yield* fs.readFileString('.oxlintrc.json'));
    yield* fs.writeFileString(
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
      yield* fs.makeDirectory(dirname(target), { recursive: true });
      yield* fs.writeFileString(target, serializeHtmlAsJsx(yield* fs.readFileString(file)));
    }
    const result = yield* command.run([oxlint, '-c', join(folder, '.oxlintrc.json'), folder], {
      cwd: folder,
    });
    return { ok: result.code === 0, output: resolveHtmlReport(`${result.stdout}${result.stderr}`, folder) };
  },
  Effect.scoped,
  Effect.orDie
);

export const lintHtml = Effect.fn('HtmlLint.lint')(function* () {
  const files = yield* (yield* Command).lines(['git', 'ls-files', '*.html']).pipe(Effect.orDie);
  const { ok, output } = yield* runHtmlLint(files, join(process.cwd(), 'node_modules/.bin/oxlint'));
  if (!ok) return yield* new HtmlLintFailed({ message: output });
  if (output.trim()) yield* Console.log(output.trimEnd());
});

const main = lintHtml().pipe(reportFailure, Effect.provide(CommandLayer));

if (import.meta.main) BunRuntime.runMain(main, { disableErrorReporting: true });
