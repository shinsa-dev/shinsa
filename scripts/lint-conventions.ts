import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse } from '@babel/parser';

type Violation = { file: string; line: number; message: string };

type BabelComment = { type: string; value: string; loc: { start: { line: number } } };

type BabelNode = {
  type: string;
  loc?: { start: { line: number } };
  [key: string]: unknown;
};

interface ClassRule {
  pattern: RegExp;
  message: string;
  roots: readonly string[];
  unless?: RegExp;
  allowedIn?: string;
  inCatalog?: boolean;
}

const ROOTS = ['apps/server/src', 'apps/server/test', 'apps/web/src', 'apps/web/test', 'packages', 'scripts'];

const SKIPPED_SEGMENTS = new Set(['node_modules', 'dist']);

const BANNED_VERB_PATTERN = /^(get|fetch|load|set|delete|destroy)[A-Z]/;

const VERB_CATALOG =
  'find*, select*, list*, count*, resolve*, create*, update*, upsert*, write*, replace*, remove*, assert*, serialize*, parse*, validate*, describe*, request*, sync*, apply*, record*, is*, has*, needs*';

const VERB_CHECK_ROOTS = ['apps/server/src', 'apps/web/src', 'packages/core'];

const COMMENT_CHECK_EXCLUDED_ROOTS = ['packages/ui'];

const ALLOWED_COMMENT_PATTERN = /^\s*(biome-ignore|@ts-)/;

const APP = ['apps/web/src'];

const APP_AND_KIT = ['apps/web/src', 'packages/ui/src'];

const CATALOG = ['index', 'tokens', 'inputs', 'overlays', 'surfaces'].map(
  (name) => `apps/web/src/routes/ui/${name}.tsx`
);

const ICON_FADE_MESSAGE =
  "An icon's strength set at the call site. It is --icon-alpha: a reveal goes opacity-0 → opacity-(--icon-alpha), and equal strength is icon-solid (docs/design.md → Where Shinsa differs, 19)";

const CLASS_RULES: ClassRule[] = [
  {
    pattern: /(?:^|[\s:'"`])text-\[\d/,
    message: 'Raw font size. Use a type role (docs/design.md → Sizing → Type roles)',
    roots: APP,
  },
  {
    pattern: /(?:^|[\s:'"`])font-(?:thin|extralight|light|bold|extrabold|black|\[)/,
    message:
      'A weight other than normal, font-medium or font-semibold. Those three are the only weights (docs/design.md → Weight)',
    roots: APP,
  },
  {
    pattern: /(?:^|[\s:'"`])gap(?:-[xy])?-0\.5\b/,
    message:
      'A 2px gap. A title over its description is gap-px, anything wider is gap-1 or more. The one 2px gap is between the buttons of a section header, and SectionLabel owns it',
    roots: APP,
    allowedIn: 'apps/web/src/components/layout/page/section-label.tsx',
  },
  {
    pattern: /(?:^|[\s:'"`])shadow-(?:2xs|xs|sm|md|lg|xl|2xl|inner)\b/,
    message:
      'A Tailwind shadow. Depth comes from the shadow tokens: shadow-1…4 and shadow-control* (docs/design.md → No shadows)',
    roots: APP,
  },
  {
    pattern: /(?:^|[\s:'"`])(?:shadow|ring)-\[/,
    message:
      'A raw shadow or ring. Use the shadow tokens: shadow-1…4 and shadow-control* (docs/design.md → No shadows)',
    roots: APP,
  },
  {
    pattern: /svg[^\s'"`]*\]:opacity-|(?:^|[\s:'"`])icon-tertiary\b|\[--icon-alpha:/,
    message:
      'An icon faded by hand. Icon draws at --icon-alpha (85% of its text, 90% in menu rows); change a context with icon-solid or icon-item (docs/design.md → Where Shinsa differs, 19)',
    roots: APP_AND_KIT,
  },
  {
    pattern: /(?:^|[\s'"`])hover:/,
    unless: /(?:^|[\s'"`])active:/,
    message:
      'Hover is the only feedback. Pair every hover: class with the same active: value on the same line (docs/design.md → Where Shinsa differs, 15)',
    roots: APP,
  },
  {
    pattern: /(?:^|[\s'"`])group-hover(?:\/[\w-]+)?:/,
    unless: /(?:^|[\s'"`])group-active(?:\/[\w-]+)?:|(?:^|[\s'"`])opacity-0\b/,
    message:
      'Hover is the only feedback. Pair group-hover: with group-active: (docs/design.md → Where Shinsa differs, 15)',
    roots: APP,
  },
  {
    pattern: /(?:^|[\s'"`])rounded-xl border border-border bg-card\b/,
    message:
      'A hand-built card. Use CARD from components/layout/surface/card.ts (docs/design.md → Where Shinsa differs, 15)',
    roots: APP,
  },
  {
    pattern: /(?:^|[\s:'"`])(?:[a-z]+:)*rounded(?:-[trblse]{1,2})?-\[(?!inherit\])/,
    message:
      'Raw corner. Corners come from the radius tokens, and a nested corner is concentric: inner = outer − padding. Use rounded-control / -control-sm / -popup / -item / -segment (globals.css → Corners), or add a derived token there',
    roots: APP_AND_KIT,
    inCatalog: true,
  },
  {
    pattern:
      /(?:^|[\s'"`])[^\s'"`]*\b(?:focus|focus-visible|focus-within)(?:\/[\w-]+)?:(?=[^\s'"`])|(?:^|[\s'"`:])ring-offset-/,
    message:
      'A focus state. Shinsa draws no focus rings, outlines or focus washes; keep outline-none (docs/design.md → No focus states)',
    roots: APP_AND_KIT,
  },
];

const FADED_ICON = /(?:^|\s)(?:[\w/-]+:)*opacity-(?!0(?:\s|$)|\(--icon-alpha\)(?:\s|$))\S+/;

const CHECKMARK_ICON = /^IconCheck(?:mark|Circle)/;

const GREEN_CLASS = /(?:^|\s)(?:\S+:)?[a-z]+-(?:green(?:-\d+)?|success)(?:\/\d+)?(?=\s|$)/;

const GREEN_MESSAGE =
  "A green checkmark. Checkmarks are the accent (only the progress track's done steps are green): CheckMark / CHECK_TEXT from components/status/check-mark.tsx";

const TIME_CHECK_ROOTS = ['apps/web/src'];

const TIME_COMPONENT_FILE = 'apps/web/src/components/text/time-ago.tsx';

const TIME_FORMATTERS = new Set(['formatAge', 'formatDuration']);

const TIME_COMPONENTS = new Set(['TimeAgo', 'Duration']);

const TIME_MESSAGE =
  'A time rendered without its tooltip. Render it through TimeAgo or Duration (components/text/time-ago.tsx), so hovering shows the exact time (docs/design.md → Where Shinsa differs, 13)';

function listSourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    if (SKIPPED_SEGMENTS.has(entry)) continue;
    const path = join(root, entry);
    if (statSync(path).isDirectory()) {
      files.push(...listSourceFiles(path));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.d.ts')) files.push(path);
  }
  return files;
}

function isUnder(file: string, roots: readonly string[]) {
  return roots.some((root) => file.startsWith(root));
}

function collectCommentViolations(file: string, comments: BabelComment[], violations: Violation[]): void {
  for (const comment of comments) {
    const inner = comment.value.trim();
    if (inner.length === 0 || ALLOWED_COMMENT_PATTERN.test(inner)) continue;
    violations.push({
      file,
      line: comment.loc.start.line,
      message: `A comment. Names and structure carry the meaning, and docs/ carries the rest: "${inner.slice(0, 60)}"`,
    });
  }
}

function readName(node: unknown): { name: string; line: number } | null {
  const id = node as (BabelNode & { name?: string }) | null;
  if (id?.type !== 'Identifier' || !id.name) return null;
  return { name: id.name, line: id.loc?.start.line ?? 0 };
}

function declaredFunctionName(node: BabelNode): { name: string; line: number } | null {
  if (node.type === 'FunctionDeclaration') return readName(node.id);
  if (node.type === 'ClassMethod' || node.type === 'ObjectMethod') return readName(node.key);
  if (node.type !== 'VariableDeclarator') return null;
  const init = node.init as BabelNode | null;
  const isFunction = init?.type === 'ArrowFunctionExpression' || init?.type === 'FunctionExpression';
  return isFunction ? readName(node.id) : null;
}

function listChildren(node: BabelNode): BabelNode[] {
  return Object.values(node).flatMap((value) => {
    const candidates = Array.isArray(value) ? value : [value];
    return candidates.filter(
      (child): child is BabelNode => Boolean(child) && typeof child === 'object' && 'type' in child
    );
  });
}

function walk(
  node: BabelNode,
  visit: (node: BabelNode, ancestors: BabelNode[]) => void,
  ancestors: BabelNode[] = []
): void {
  visit(node, ancestors);
  const next = [...ancestors, node];
  for (const child of listChildren(node)) walk(child, visit, next);
}

function collectVerbViolations(file: string, program: BabelNode, violations: Violation[]): void {
  walk(program, (node) => {
    const declaration = declaredFunctionName(node);
    if (!declaration || !BANNED_VERB_PATTERN.test(declaration.name)) return;
    violations.push({
      file,
      line: declaration.line,
      message: `Banned verb prefix on "${declaration.name}". Use the verb catalog: ${VERB_CATALOG} (the conventions skill)`,
    });
  });
}

function readElementName(node: BabelNode): string | null {
  const name = (node.openingElement as BabelNode | undefined)?.name as
    | (BabelNode & { name?: string })
    | undefined;
  return name?.type === 'JSXIdentifier' && name.name ? name.name : null;
}

function isUntimedFormatter(node: BabelNode, ancestors: BabelNode[]): boolean {
  if (node.type !== 'CallExpression') return false;
  const callee = node.callee as BabelNode & { name?: string };
  if (callee.type !== 'Identifier' || !callee.name || !TIME_FORMATTERS.has(callee.name)) return false;
  if (!ancestors.some((ancestor) => ancestor.type.startsWith('JSX'))) return false;
  const attribute = ancestors.some((ancestor) => ancestor.type === 'JSXAttribute');
  const element = [...ancestors].reverse().find((ancestor) => ancestor.type === 'JSXElement');
  const owner = element ? readElementName(element) : null;
  return !(attribute && owner && TIME_COMPONENTS.has(owner));
}

function listStrings(node: BabelNode | null | undefined): string[] {
  if (!node) return [];
  const strings: string[] = [];
  walk(node, (child) => {
    if (child.type === 'StringLiteral') strings.push(String(child.value));
    if (child.type === 'TemplateElement')
      strings.push(String((child.value as { cooked?: string }).cooked ?? ''));
  });
  return strings;
}

function readKey(node: BabelNode): string | null {
  const key = (node.key ?? node.name) as (BabelNode & { name?: string; value?: string }) | undefined;
  if (key?.type === 'Identifier' || key?.type === 'JSXIdentifier') return key.name ?? null;
  return key?.type === 'StringLiteral' ? (key.value ?? null) : null;
}

function readProps(node: BabelNode): Map<string, string[]> {
  const entries = (node.type === 'ObjectExpression' ? node.properties : node.attributes) as BabelNode[];
  const props = new Map<string, string[]>();
  for (const entry of entries) {
    const key = readKey(entry);
    if (key) props.set(key, listStrings((entry.value as BabelNode | null) ?? null));
  }
  return props;
}

function hasValue(props: Map<string, string[]>, key: string, test: (value: string) => boolean) {
  return (props.get(key) ?? []).some(test);
}

function isCheckmark(props: Map<string, string[]>) {
  const matches = (value: string) => CHECKMARK_ICON.test(value);
  return hasValue(props, 'name', matches) || hasValue(props, 'icon', matches);
}

function isGreen(props: Map<string, string[]> | null) {
  if (!props) return false;
  const named = (value: string) => value === 'green';
  if (hasValue(props, 'tone', named) || hasValue(props, 'variant', named)) return true;
  return hasValue(props, 'className', (value) => GREEN_CLASS.test(value));
}

function readParentProps(ancestors: BabelNode[]) {
  const elements = ancestors.filter((ancestor) => ancestor.type === 'JSXElement');
  const parent = elements.at(-2)?.openingElement as BabelNode | undefined;
  return parent ? readProps(parent) : null;
}

function isGreenCheckmark(node: BabelNode, ancestors: BabelNode[]) {
  if (node.type !== 'ObjectExpression' && node.type !== 'JSXOpeningElement') return false;
  const props = readProps(node);
  if (!isCheckmark(props)) return false;
  if (isGreen(props)) return true;
  return node.type === 'JSXOpeningElement' && isGreen(readParentProps(ancestors));
}

function isIconElement(node: BabelNode) {
  if (node.type !== 'JSXOpeningElement') return false;
  const name = (node.name as BabelNode & { name?: string }).name ?? '';
  return name === 'Icon' || name.endsWith('Chevron');
}

function isFadedIcon(node: BabelNode) {
  if (!isIconElement(node)) return false;
  return hasValue(readProps(node), 'className', (value) => FADED_ICON.test(value));
}

function collectSyntaxViolations(file: string, program: BabelNode, violations: Violation[]): void {
  const timed = file.endsWith('.tsx') && file !== TIME_COMPONENT_FILE && isUnder(file, TIME_CHECK_ROOTS);
  const styled = isUnder(file, APP_AND_KIT) && !CATALOG.includes(file);
  walk(program, (node, ancestors) => {
    const line = node.loc?.start.line ?? 0;
    if (timed && isUntimedFormatter(node, ancestors)) violations.push({ file, line, message: TIME_MESSAGE });
    if (!styled) return;
    if (isFadedIcon(node)) violations.push({ file, line, message: ICON_FADE_MESSAGE });
    if (isGreenCheckmark(node, ancestors)) violations.push({ file, line, message: GREEN_MESSAGE });
  });
}

function isRuleBroken(rule: ClassRule, file: string, line: string) {
  if (file === rule.allowedIn || !isUnder(file, rule.roots)) return false;
  if (CATALOG.includes(file) && !rule.inCatalog) return false;
  return rule.pattern.test(line) && !rule.unless?.test(line);
}

function collectClassViolations(file: string, source: string, violations: Violation[]): void {
  if (!file.endsWith('.tsx')) return;
  source.split('\n').forEach((line, index) => {
    for (const rule of CLASS_RULES) {
      if (isRuleBroken(rule, file, line)) violations.push({ file, line: index + 1, message: rule.message });
    }
  });
}

function parseSource(file: string, source: string) {
  return parse(source, {
    sourceType: 'module',
    plugins: file.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'],
    attachComment: false,
  }) as unknown as { program: BabelNode; comments?: BabelComment[] | null };
}

function checkFile(file: string, violations: Violation[]): void {
  const source = readFileSync(file, 'utf8');
  let parsed: ReturnType<typeof parseSource>;
  try {
    parsed = parseSource(file, source);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    violations.push({ file, line: 1, message: `Could not parse: ${reason}` });
    return;
  }
  if (!isUnder(file, COMMENT_CHECK_EXCLUDED_ROOTS)) {
    collectCommentViolations(file, parsed.comments ?? [], violations);
  }
  collectClassViolations(file, source, violations);
  collectSyntaxViolations(file, parsed.program, violations);
  if (isUnder(file, VERB_CHECK_ROOTS)) collectVerbViolations(file, parsed.program, violations);
}

function run(): void {
  const violations: Violation[] = [];
  for (const root of ROOTS.filter((candidate) => existsSync(candidate))) {
    for (const file of listSourceFiles(root)) checkFile(file, violations);
  }
  if (violations.length === 0) return;
  for (const violation of violations) {
    process.stderr.write(
      `${relative(process.cwd(), violation.file)}:${violation.line} ${violation.message}\n`
    );
  }
  process.stderr.write(`\n${violations.length} convention violation(s).\n`);
  process.exit(1);
}

run();
