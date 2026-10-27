interface DesignLintRule {
  pattern: RegExp;
  message: string;
  roots: readonly string[];
  unless?: RegExp;
  allowedIn?: string;
  inCatalog?: boolean;
}

export interface DesignSources {
  source: string;
  kitStylesheet: string;
  webStylesheets: readonly { name: string; css: string }[];
  tailwindTheme: string;
  iconNames: readonly string[];
  customIconNames: readonly string[];
  lint: DesignLintModule;
}

interface DesignLintModule {
  readonly CLASS_RULES: readonly DesignLintRule[];
  readonly BANNED_VERB_PATTERN: RegExp;
  readonly VERB_CATALOG: string;
  readonly [name: string]: unknown;
}

interface CssBlock {
  prelude: string;
  body: string;
  text: string;
}

type CssEntry = { kind: 'comment'; text: string } | { kind: 'decl'; name: string; value: string };

interface TokenRow {
  name: string;
  light: string;
  dark: string;
}

interface TokenGroup {
  title: string;
  notes: string[];
  rows: TokenRow[];
}

const MARKER = /^<!-- design:([a-z-]+) -->$/;

const ROOT = ':root';

const ALIASES = '.dark, :root';

const DARK = '.dark';

const THEME = '@theme inline';

const TONES = 'blue|red|green|amber|purple|sky|yellow|pink|orange';

const TOKEN_GROUPS: readonly [string, RegExp][] = [
  ['Press feedback', /^--press-inset/],
  ['Icon sizes', /^--icon-size/],
  ['Page and surfaces', /^--(?:background|bg-[1-4]$|sidebar)/],
  ['Text (the foreground ladder)', /^--fg-[1-4]$/],
  ['Icon inks', /^--icon-[1-4]$/],
  ['Alpha washes and inks', /^--(?:bg|fg)-a[1-4]$/],
  ['Primary (the one accent)', /^--primary/],
  ['Tone ramps', new RegExp(`^--(?:${TONES})-[1-4]$`)],
  ['Tone alphas', new RegExp(`^--(?:${TONES})-a[1-4]$`)],
  ['Text on a tint', new RegExp(`^--(?:${TONES})-text$`)],
  ['Shadow recipes', /^--(?:control|surface)-shadow/],
  ['File marks', /^--file-/],
  ['Code syntax and diff', /^--code-/],
  ['Semantic mapping', /^--(?:foreground|card|popover|muted|destructive|border|input|ring)/],
  ['Selection', /^--selection/],
];

export function serializeDesign(sources: DesignSources): string {
  const kit = listCssBlocks(sources.kitStylesheet);
  const sections: Record<string, () => string> = {
    tokens: () => describeTokens(kit),
    theme: () => describeTheme(kit),
    scales: () => describeScales(kit, listCssBlocks(sources.tailwindTheme)),
    utilities: () => describeUtilities(kit),
    icons: () => describeIcons(sources.iconNames, sources.customIconNames),
    lint: () => describeLint(sources.lint),
    'kit-stylesheet': () => fence('css', sources.kitStylesheet.trim()),
    'web-stylesheet': () =>
      sources.webStylesheets
        .map((sheet) => `\`${sheet.name}\`\n\n${fence('css', sheet.css.trim())}`)
        .join('\n\n'),
  };
  const used = new Set<string>();
  const body = sources.source
    .split('\n')
    .map((line) => {
      const name = MARKER.exec(line.trim())?.[1];
      if (name === undefined || name === 'toc') return line;
      const section = sections[name];
      if (!section) throw new Error(`Unknown design marker "${name}"`);
      used.add(name);
      return section();
    })
    .join('\n');
  const missing = Object.keys(sections).filter((name) => !used.has(name));
  if (missing.length > 0) throw new Error(`Missing design markers: ${missing.join(', ')}`);
  const contents = describeContents(body);
  return `${body.replace(/^<!-- design:toc -->$/m, contents).trim()}\n`;
}

function listCssBlocks(css: string): CssBlock[] {
  const blocks: CssBlock[] = [];
  let depth = 0;
  let start = 0;
  let open = 0;
  let index = 0;
  while (index < css.length) {
    if (css.startsWith('/*', index)) {
      index = css.indexOf('*/', index + 2) + 2;
      if (depth === 0) start = index;
      continue;
    }
    const char = css[index];
    if (char === '{') {
      if (depth === 0) open = index;
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        blocks.push({
          prelude: normalizeSpace(css.slice(start, open)),
          body: css.slice(open + 1, index),
          text: css.slice(start, index + 1).trim(),
        });
        start = index + 1;
      }
    } else if (char === ';' && depth === 0) {
      blocks.push({
        prelude: normalizeSpace(css.slice(start, index)),
        body: '',
        text: css.slice(start, index + 1).trim(),
      });
      start = index + 1;
    }
    index += 1;
  }
  return blocks;
}

function listCssEntries(body: string): CssEntry[] {
  const entries: CssEntry[] = [];
  let index = 0;
  while (index < body.length) {
    if (/\s/.test(body[index] ?? '')) {
      index += 1;
      continue;
    }
    if (body.startsWith('/*', index)) {
      const end = body.indexOf('*/', index + 2);
      entries.push({ kind: 'comment', text: body.slice(index + 2, end) });
      index = end + 2;
      continue;
    }
    let depth = 0;
    let cursor = index;
    while (cursor < body.length && !(depth === 0 && (body[cursor] === ';' || body[cursor] === '{'))) {
      if (body[cursor] === '(') depth += 1;
      if (body[cursor] === ')') depth -= 1;
      cursor += 1;
    }
    if (body[cursor] === '{') {
      cursor = skipBlock(body, cursor);
    } else {
      const declaration = body.slice(index, cursor);
      const colon = declaration.indexOf(':');
      const name = declaration.slice(0, colon).trim();
      if (name.startsWith('--'))
        entries.push({ kind: 'decl', name, value: normalizeSpace(declaration.slice(colon + 1)) });
    }
    index = cursor + 1;
  }
  return entries;
}

export function listTokenNames(css: string): string[] {
  const blocks = listCssBlocks(css).filter((block) => [ROOT, ALIASES, DARK, THEME].includes(block.prelude));
  return unique(blocks.flatMap((block) => listDeclarations(block.body).map((entry) => entry.name)));
}

function skipBlock(body: string, open: number) {
  let depth = 0;
  let cursor = open;
  do {
    if (body[cursor] === '{') depth += 1;
    if (body[cursor] === '}') depth -= 1;
    cursor += 1;
  } while (depth > 0 && cursor < body.length);
  return cursor - 1;
}

function listDeclarations(body: string) {
  return listCssEntries(body).filter((entry) => entry.kind === 'decl');
}

function selectBlocks(blocks: CssBlock[], prelude: string) {
  return blocks.filter((block) => block.prelude === prelude);
}

function resolveValues(blocks: CssBlock[], prelude: string) {
  return new Map(
    selectBlocks(blocks, prelude).flatMap((block) =>
      listDeclarations(block.body).map((entry) => [entry.name, entry.value] as const)
    )
  );
}

function listNotes(blocks: CssBlock[]) {
  const notes = new Map<string, string>();
  for (const block of blocks) {
    let pending: string[] = [];
    for (const entry of listCssEntries(block.body)) {
      if (entry.kind === 'comment') {
        pending.push(describeComment(entry.text));
        continue;
      }
      if (pending.length > 0 && !notes.has(entry.name)) notes.set(entry.name, pending.join(' '));
      pending = [];
    }
  }
  return notes;
}

function describeComment(text: string) {
  return normalizeSpace(
    text
      .split('\n')
      .map((line) => line.replace(/^\s*\*\s?/, ''))
      .join(' ')
      .replace(/\s*\([^()]*(?:docs\/|\.css|\.tsx?\b|\.md\b)[^()]*\)/g, '')
  );
}

function groupRows<T extends { name: string }>(rows: T[], groups: readonly [string, RegExp][]) {
  const grouped = groups.map(([title, pattern]) => ({
    title,
    rows: rows.filter((row) => pattern.test(row.name)),
  }));
  const rest = rows.filter((row) => !groups.some(([, pattern]) => pattern.test(row.name)));
  return [...grouped, { title: 'Other', rows: rest }].filter((group) => group.rows.length > 0);
}

function describeTokens(blocks: CssBlock[]) {
  const light = new Map([...resolveValues(blocks, ROOT)]);
  const aliases = resolveValues(blocks, ALIASES);
  const dark = resolveValues(blocks, DARK);
  const names = unique([...light.keys(), ...aliases.keys(), ...dark.keys()]);
  const notes = listNotes([
    ...selectBlocks(blocks, ROOT),
    ...selectBlocks(blocks, ALIASES),
    ...selectBlocks(blocks, DARK),
  ]);
  const rows: TokenRow[] = names.map((name) => {
    const lightValue = light.get(name) ?? aliases.get(name) ?? '';
    return { name, light: lightValue, dark: dark.get(name) ?? aliases.get(name) ?? lightValue };
  });
  const groups: TokenGroup[] = groupRows(rows, TOKEN_GROUPS).map((group) => ({
    ...group,
    notes: unique(group.rows.flatMap((row) => notes.get(row.name) ?? [])),
  }));
  const scoped = blocks.filter(
    (block) =>
      !block.prelude.startsWith('@') &&
      ![ROOT, ALIASES, DARK].includes(block.prelude) &&
      listDeclarations(block.body).length > 0
  );
  return [
    ...groups.flatMap((group) => [
      `### ${group.title}`,
      '',
      ...group.notes.map((note) => `> ${note}\n`),
      '| Token | Light | Dark |',
      '| --- | --- | --- |',
      ...group.rows.map((row) => `| \`${row.name}\` | \`${row.light}\` | \`${row.dark}\` |`),
      '',
    ]),
    '### Tokens redefined inside a region',
    '',
    ...scoped.map((block) => fence('css', block.text)),
    '',
  ].join('\n');
}

function describeTheme(blocks: CssBlock[]) {
  const theme = selectBlocks(blocks, THEME);
  const entries = listDeclarations(theme.map((block) => block.body).join('\n'));
  const notes = listNotes(theme);
  const colours = entries.filter((entry) => entry.name.startsWith('--color-'));
  const plain = colours.filter((entry) => entry.value === `var(--${entry.name.slice('--color-'.length)})`);
  const others = entries.filter((entry) => !plain.includes(entry));
  return [
    '### Colour utilities',
    '',
    'Each of these is a Tailwind colour, so it works in every colour utility (`bg-…`, `text-…`, `border-…`, `fill-…`, `stroke-…`, `from-…`, `ring-…`, `outline-…`, `divide-…`, `decoration-…`, `caret-…`, `accent-…`, `placeholder-…`) and resolves to the token named after `--color-` (`--color-bg-2` is `bg-bg-2`, `text-bg-2`, `border-bg-2` and resolves to `--bg-2`):',
    '',
    plain.map((entry) => `\`${entry.name}\``).join(', '),
    '',
    '### Theme variables',
    '',
    ...unique(others.flatMap((entry) => notes.get(entry.name) ?? [])).map((note) => `> ${note}\n`),
    '| Theme variable | Value |',
    '| --- | --- |',
    ...others.map((entry) => `| \`${entry.name}\` | \`${entry.value}\` |`),
    '',
  ].join('\n');
}

function describeScales(kit: CssBlock[], tailwind: CssBlock[]) {
  const defaults = new Map(
    tailwind
      .filter((block) => block.prelude.startsWith('@theme'))
      .flatMap((block) => listDeclarations(block.body).map((entry) => [entry.name, entry.value] as const))
  );
  const own = resolveValues(kit, THEME);
  const values = new Map([...defaults, ...resolveValues(kit, ROOT), ...resolveValues(kit, ALIASES), ...own]);
  const names = (pattern: RegExp) =>
    unique([...defaults.keys(), ...own.keys()].filter((name) => pattern.test(name)));
  const origin = (...keys: string[]) => (keys.some((key) => own.has(key)) ? 'Shinsa' : 'Tailwind');
  const sizes = names(/^--text-[\w]+$/)
    .filter((name) => !name.startsWith('--text-shadow'))
    .map((name) => {
      const size = measure(values.get(name) ?? '', values) ?? 0;
      const leadingKey = `${name}--line-height`;
      const leading = measure(values.get(leadingKey) ?? '', values);
      const source = own.has(name) ? 'Shinsa' : own.has(leadingKey) ? 'Shinsa (line height)' : 'Tailwind';
      return { name, size, leading, origin: source };
    })
    .sort((left, right) => left.size - right.size);
  const scale = (pattern: RegExp, prefix: string, unit?: (name: string) => string) =>
    names(pattern)
      .map((name) =>
        [
          `\`${prefix}${name.replace(/^--[a-z]+-(?:weight-)?/, '')}\``,
          `\`${values.get(name)}\``,
          ...(unit ? [unit(name)] : []),
          origin(name),
        ].join(' | ')
      )
      .map((row) => `| ${row} |`);
  const px = (name: string) => describeNumber(measure(values.get(name) ?? '', values), 'px');
  return [
    '### Type scale (effective)',
    '',
    '| Class | Font size | px | Line height | Line height px | Defined by |',
    '| --- | --- | --- | --- | --- | --- |',
    ...sizes.map(
      (size) =>
        `| \`${size.name.replace('--', '')}\` | \`${values.get(size.name)}\` | ${describeNumber(size.size, 'px')} | ${describeNumber(size.leading, '')} | ${describeNumber(size.leading === null ? null : size.leading * size.size, 'px')} | ${size.origin} |`
    ),
    '',
    '### Weights (effective)',
    '',
    '| Class | Value | Defined by |',
    '| --- | --- | --- |',
    ...scale(/^--font-weight-/, 'font-'),
    '',
    '### Tracking and leading (effective)',
    '',
    '| Class | Value | Defined by |',
    '| --- | --- | --- |',
    ...scale(/^--tracking-/, 'tracking-'),
    ...scale(/^--leading-/, 'leading-'),
    '',
    '### Corners (effective)',
    '',
    '| Class | Value | px | Defined by |',
    '| --- | --- | --- | --- |',
    ...scale(/^--radius-/, 'rounded-', px),
    '',
    '### Spacing, breakpoints and containers',
    '',
    '| Variable | Value | px | Defined by |',
    '| --- | --- | --- | --- |',
    ...names(/^--(?:spacing|breakpoint-|container-)/).map(
      (name) => `| \`${name}\` | \`${values.get(name)}\` | ${px(name)} | ${origin(name)} |`
    ),
    '',
    '### Easing, animation and transition defaults',
    '',
    '| Variable | Value | Defined by |',
    '| --- | --- | --- |',
    ...names(/^--(?:ease-|animate-|default-transition-)/).map(
      (name) => `| \`${name}\` | \`${values.get(name)}\` | ${origin(name)} |`
    ),
    '',
  ].join('\n');
}

function describeUtilities(blocks: CssBlock[]) {
  const pick = (prefix: string) => blocks.filter((block) => block.prelude.startsWith(prefix));
  const parts: [string, CssBlock[]][] = [
    ['Custom variants', pick('@custom-variant')],
    ['Custom utilities', [...pick('@utility'), ...pick('@layer utilities')]],
    ['Registered properties', pick('@property')],
    ['Keyframes', pick('@keyframes')],
  ];
  return parts
    .flatMap(([title, list]) => [`### ${title}`, '', ...list.map((block) => fence('css', block.text)), ''])
    .join('\n');
}

function describeIcons(names: readonly string[], custom: readonly string[]) {
  const sorted = [...names].sort((left, right) => left.localeCompare(right));
  const letters = unique(sorted.map((name) => name.slice(4, 5).toUpperCase()));
  const filled = sorted.filter((name) => name.endsWith('Filled'));
  const drawn = sorted.filter((name) => custom.includes(name));
  return [
    `${sorted.length} icons are available. Use exactly these names; any other name does not render.`,
    '',
    '| | Icons |',
    '| --- | --- |',
    ...letters.map(
      (letter) =>
        `| ${letter} | ${sorted
          .filter((name) => name.slice(4, 5).toUpperCase() === letter)
          .map((name) => `\`${name}\``)
          .join(', ')} |`
    ),
    '',
    `Filled twins (the current tab or nav item shows these): ${filled.map((name) => `\`${name}\``).join(', ')}.`,
    '',
    `Drawn by Shinsa because Central does not carry them: ${drawn.map((name) => `\`${name}\``).join(', ')}.`,
    '',
  ].join('\n');
}

function describeLint(lint: DesignSources['lint']) {
  const messages = Object.entries(lint).flatMap(([name, value]) =>
    name.endsWith('_MESSAGE') && typeof value === 'string' ? [value] : []
  );
  const rules = lint.CLASS_RULES.map((rule, index) => {
    const [title = '', ...rest] = describeMessage(rule.message).split('. ');
    const lines = [
      `##### ${index + 1}. ${title.replace(/\.$/, '')}`,
      '',
      rest.length > 0 ? `${rest.join('. ')}.`.replace(/\.\.$/, '.') : '',
      '',
      `- Checked in: ${rule.roots.map((root) => `\`${root}\``).join(', ')}${rule.inCatalog ? ', including the /ui specimen pages' : ', except the /ui specimen pages'}.`,
      ...(rule.allowedIn ? [`- Allowed in one file only: \`${rule.allowedIn}\`.`] : []),
      '- A line fails when it matches:',
      '',
      fence('text', rule.pattern.source),
      ...(rule.unless ? ['- unless the same line also matches:', '', fence('text', rule.unless.source)] : []),
      '',
    ];
    return lines.join('\n');
  });
  return [
    '#### Class rules, line by line',
    '',
    'Every `.tsx` line in the listed folders is tested against each pattern below. These are the exact regular expressions the linter runs.',
    '',
    ...rules,
    '#### Checks on the component tree',
    '',
    'These read the parsed JSX rather than one line, and fail with these exact messages:',
    '',
    ...messages
      .filter((message) => !lint.CLASS_RULES.some((rule) => rule.message === message))
      .map((message) => `- ${describeMessage(message)}`),
    '',
    '#### Function names',
    '',
    `A function, method or arrow assigned to a name fails when its name matches \`${lint.BANNED_VERB_PATTERN.source}\`. Use the verb catalog instead: ${lint.VERB_CATALOG.split(
      ', '
    )
      .map((verb) => `\`${verb}\``)
      .join(', ')}.`,
    '',
  ].join('\n');
}

function describeMessage(message: string) {
  return normalizeSpace(message.replace(/\s*\((?:docs\/|globals\.css|the conventions skill)[^()]*\)/g, ''));
}

function describeContents(body: string) {
  const entries: string[] = [];
  const seen = new Map<string, number>();
  let fenced = false;
  for (const line of body.split('\n')) {
    if (line.startsWith('```')) fenced = !fenced;
    const heading = fenced ? null : /^(#{1,6}) (.+)$/.exec(line);
    if (!heading) continue;
    const [, marks = '', title = ''] = heading;
    const slug = slugify(title);
    const count = seen.get(slug) ?? 0;
    seen.set(slug, count + 1);
    const anchor = count === 0 ? slug : `${slug}-${count}`;
    if (marks === '##') entries.push(`- [${title}](#${anchor})`);
    if (marks === '###') entries.push(`  - [${title}](#${anchor})`);
  }
  return entries.join('\n');
}

export function slugify(heading: string) {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

function measure(value: string, values: Map<string, string>, depth = 0): number | null {
  const resolved = value.replace(/var\((--[\w-]+)\)/g, (_, name: string) =>
    depth > 8 ? 'NaN' : `(${measure(values.get(name) ?? 'NaN', values, depth + 1) ?? 'NaN'})`
  );
  const expression = resolved
    .replace(/calc/g, '')
    .replace(/(-?\d*\.?\d+)rem\b/g, (_, number: string) => String(Number(number) * 16))
    .replace(/(-?\d*\.?\d+)px\b/g, '$1');
  if (!/^[\d\s.+\-*/()]+$/.test(expression)) return null;
  return evaluate(expression);
}

function evaluate(expression: string): number | null {
  const tokens = expression.match(/\d*\.?\d+|[()+\-*/]/g) ?? [];
  let position = 0;
  const readFactor = (): number => {
    const token = tokens[position];
    position += 1;
    if (token === '(') {
      const value = readSum();
      position += 1;
      return value;
    }
    if (token === '-') return -readFactor();
    return Number(token);
  };
  const readProduct = (): number => {
    let value = readFactor();
    while (tokens[position] === '*' || tokens[position] === '/') {
      const operator = tokens[position];
      position += 1;
      const right = readFactor();
      value = operator === '*' ? value * right : value / right;
    }
    return value;
  };
  const readSum = (): number => {
    let value = readProduct();
    while (tokens[position] === '+' || tokens[position] === '-') {
      const operator = tokens[position];
      position += 1;
      const right = readProduct();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  };
  const value = readSum();
  return Number.isFinite(value) ? value : null;
}

function describeNumber(value: number | null, unit: string) {
  if (value === null) return '';
  return `${Number(value.toFixed(3))}${unit}`;
}

function fence(language: string, text: string) {
  return `\`\`\`${language}\n${text}\n\`\`\``;
}

function normalizeSpace(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}
