import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CentralIcon } from '@central-icons-react/all';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CUSTOM_ICON_PATHS } from '../src/components/icon/custom';

export type IconRadius = '0' | '1' | '2' | '3';

export type Discovered = Map<string, Set<IconRadius>>;

export const DEFAULT_RADIUS: IconRadius = '3';

const ROOT = resolve(import.meta.dirname, '../../..');

const SCAN_ROOTS = ['apps', 'packages'].map((dir) => resolve(ROOT, dir));

export const OUT = resolve(import.meta.dirname, '../src/components/icon/paths.ts');

const INDEX = resolve(import.meta.dirname, '../node_modules/@central-icons-react/all/icons-index.json');

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'test', '.turbo', '.react-router', '.wrangler']);
const SOURCE_FILE = /\.(tsx?|jsx?|mdx|astro)$/;
const TEST_FILE = /\.test\.[jt]sx?$/;

const RADII = new Set<string>(['0', '1', '2', '3']);
const NAME_ATTR = /(?:name|icon)\s*=\s*["'](Icon[A-Z][A-Za-z0-9]*)["']/g;
const NAME_PROP = /\b(?:name|icon)\s*:\s*["'](Icon[A-Z][A-Za-z0-9]*)["']/g;
const ICON_LITERAL = /["'](Icon[A-Z][A-Za-z0-9]*)["']/g;
const RADIUS_IN_TAG = /\bradius\s*=\s*["']([^"']+)["']/g;
const TAG = /<[A-Za-z][A-Za-z0-9]*\b[^<>]*\/?>/g;

/** The catalog only ships stroke widths 1 / 1.5 / 2; the checkmark's 2 reads too thin at small sizes. */
const STROKE_OVERRIDES: Record<string, string> = {
  IconCheckmark1: '2.5',
};

const OPTICAL_SCALE: Record<string, number> = {
  IconPaperPlaneTopRight: 0.9,
  IconPaperPlaneTopRightFilled: 0.9,
};

/**
 * Nudges a mark so its centre of ink, not its bounding box, sits in the middle
 * of the 24x24 box — that is what the eye reads as centred. Measured by
 * rasterising each glyph and taking the alpha-weighted centroid; a thin
 * extremity like the Apple leaf still carries some weight, so the correction is
 * damped rather than applied whole, and clamped to keep the glyph off the edge.
 */
const OPTICAL_OFFSET: Record<string, [number, number]> = {
  IconApple: [0.14, -1.03],
  IconAndroid: [0, -0.92],
};

/** Every source file under `dir` that can name an icon, skipping builds, dependencies and tests. */
export function* listSourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* listSourceFiles(path);
    else if (SOURCE_FILE.test(entry) && !TEST_FILE.test(entry)) yield path;
  }
}

/** Central's catalog (outline names; a `Filled` suffix picks the filled style) plus our custom marks. */
export function listKnownIcons(): Set<string> {
  const index = JSON.parse(readFileSync(INDEX, 'utf8')) as {
    categories: Record<string, { icons: string[] }>;
  };
  return new Set([
    ...Object.values(index.categories).flatMap((category) => category.icons),
    ...Object.keys(CUSTOM_ICON_PATHS),
  ]);
}

export function isKnownIcon(known: ReadonlySet<string>, name: string): boolean {
  return known.has(name) || known.has(name.replace(/Filled$/, ''));
}

/**
 * The icons a set of sources uses, each with the corner radii it is drawn at.
 * `name='Icon…'` and `icon: 'Icon…'` always count; any other string literal
 * counts only when it names a real icon. Every icon gets the default radius,
 * and chevrons also get radius 0, which `Icon` resolves them to.
 */
export function discoverIcons(sources: Iterable<string>, known: ReadonlySet<string>): Discovered {
  const found: Discovered = new Map();
  const note = (name: string, radius: IconRadius) => {
    const radii = found.get(name) ?? new Set<IconRadius>([DEFAULT_RADIUS]);
    radii.add(radius);
    found.set(name, radii);
  };

  for (const source of sources) {
    for (const match of source.matchAll(NAME_ATTR)) note(match[1] as string, DEFAULT_RADIUS);
    for (const match of source.matchAll(NAME_PROP)) note(match[1] as string, DEFAULT_RADIUS);
    for (const match of source.matchAll(ICON_LITERAL)) {
      const name = match[1] as string;
      if (isKnownIcon(known, name)) note(name, DEFAULT_RADIUS);
    }
    for (const tag of source.match(TAG) ?? []) {
      const radii = [...tag.matchAll(RADIUS_IN_TAG)]
        .map((match) => match[1] as string)
        .filter((radius): radius is IconRadius => RADII.has(radius));
      for (const name of [...tag.matchAll(NAME_ATTR)].map((match) => match[1] as string)) {
        for (const radius of radii) note(name, radius);
      }
    }
  }

  for (const [name, radii] of found) {
    if (name.startsWith('IconChevron')) radii.add('0');
  }
  return found;
}

function withOffset(name: string, inner: string): string {
  const offset = OPTICAL_OFFSET[name];
  return offset ? `<g transform="translate(${offset[0]} ${offset[1]})">${inner}</g>` : inner;
}

/** One icon's inner SVG markup at one radius, with the per-icon optical corrections applied. */
export function renderIconMarkup(name: string, radius: IconRadius): string {
  const custom = CUSTOM_ICON_PATHS[name];
  if (custom) return withOffset(name, custom);
  const filled = name.endsWith('Filled');
  const html = renderToStaticMarkup(
    createElement(CentralIcon, {
      name: (filled ? name.slice(0, -'Filled'.length) : name) as never,
      join: 'round',
      fill: filled ? 'filled' : 'outlined',
      radius,
      stroke: '2',
      mode: 'raw',
    })
  );
  const inner = html.match(/<svg[^>]*>([\s\S]*)<\/svg>/)?.[1];
  if (!inner) throw new Error(`Failed to extract SVG for ${name}@r${radius}`);
  const stroke = STROKE_OVERRIDES[name];
  const stroked = stroke ? inner.replaceAll('stroke-width="2"', `stroke-width="${stroke}"`) : inner;
  const scale = OPTICAL_SCALE[name];
  const scaled = scale
    ? `<g transform="translate(12 12) scale(${scale}) translate(-12 -12)">${stroked}</g>`
    : stroked;
  return withOffset(name, scaled);
}

function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** The generated `paths.ts`: names sorted, radii sorted, so the output is stable. */
export function renderIconsModule(discovered: Discovered): string {
  const names = [...discovered.keys()].sort();
  const entries = names.map((name) => {
    const radii = [...(discovered.get(name) as Set<IconRadius>)].sort();
    const lines = radii.map((radius) => `    ${quote(radius)}: ${quote(renderIconMarkup(name, radius))},`);
    return `  ${name}: {\n${lines.join('\n')}\n  },`;
  });
  return `// Generated by scripts/generate-icons.ts — do not edit by hand.
// Regenerate with: bun run --cwd packages/ui generate:icons

export const ICON_NAMES = [
${names.map((name) => `  ${quote(name)},`).join('\n')}
] as const;
export type IconName = (typeof ICON_NAMES)[number];

export type IconRadius = '0' | '1' | '2' | '3';
export const DEFAULT_ICON_RADIUS: IconRadius = '${DEFAULT_RADIUS}';

export const ICON_PATHS: Record<IconName, Partial<Record<IconRadius, string>>> = {
${entries.join('\n')}
};
`;
}

/** Scans the workspace and renders `paths.ts`; throws when nothing references an icon. */
export function generateIcons(roots: readonly string[] = SCAN_ROOTS): { module: string; icons: number } {
  const sources = roots.flatMap((root) =>
    [...listSourceFiles(root)].filter((file) => file !== OUT).map((file) => readFileSync(file, 'utf8'))
  );
  const discovered = discoverIcons(sources, listKnownIcons());
  if (discovered.size === 0) throw new Error('No icon usages found — did the scan roots change?');
  return { module: renderIconsModule(discovered), icons: discovered.size };
}
