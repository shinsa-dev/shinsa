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

const ROOTS = ['apps/server/src', 'apps/server/test', 'apps/web/src', 'packages', 'scripts'];

const SKIPPED_SEGMENTS = new Set(['node_modules', '.types', 'dist', '.wrangler', 'generated']);

const BANNED_VERB_PATTERN = /^(get|fetch|load|set|delete|destroy)[A-Z]/;

const BANNED_VERB_ALLOWLIST = new Set<string>([]);

const VERB_CHECK_ROOTS = ['apps/server/src', 'apps/web/src', 'packages/core'];

const COMMENT_CHECK_EXCLUDED_ROOTS = ['packages/ui', 'apps/web/src/features/ui'];

const CLASS_CHECK_ROOTS = ['apps/web/src'];

const CLASS_CHECK_EXCLUDED_ROOTS = ['apps/web/src/features/ui'];

const BANNED_CLASSES: { pattern: RegExp; message: string }[] = [
  {
    pattern: /(?:^|[\s:'"`])text-\[\d/,
    message: 'Raw font size; use a type role (docs/design.md → Sizing → Type roles)',
  },
  {
    pattern: /(?:^|[\s:'"`])font-(?:thin|extralight|light|bold|extrabold|black)\b/,
    message: 'Weights are 400, 450 (font-medium) and 550 (font-semibold) for inline strong only',
  },
  {
    pattern: /(?:^|[\s:'"`])gap(?:-[xy])?-0\.5\b/,
    message: 'A 2px gap; a title over its description is gap-px, anything wider is gap-1 or more',
  },
  {
    pattern: /(?:^|[\s:'"`])shadow-(?:xs|sm|md|lg|xl|[1-4])\b/,
    message:
      'No shadows in Shinsa: depth is the surface steps and one hairline ring (docs/design.md → Shape & depth)',
  },
  {
    pattern: /(?:^|[\s:'"`])(?:shadow|ring)-\[/,
    message: 'Raw shadow or ring; use the shadow tokens (shadow-1…4, shadow-control*)',
  },
];

const PAIRED_CLASSES: { pattern: RegExp; unless: RegExp; message: string }[] = [
  {
    pattern: /(?:^|[\s'"`])hover:/,
    unless: /(?:^|[\s'"`])active:/,
    message:
      'Hover is the only feedback. Pair every hover: class with the same active: value on the same line (docs/design.md → Where Shinsa differs, 15)',
  },
  {
    pattern: /(?:^|[\s'"`])group-hover(?:\/[\w-]+)?:/,
    unless: /(?:^|[\s'"`])group-active(?:\/[\w-]+)?:|(?:^|[\s'"`])opacity-0\b/,
    message:
      'Hover is the only feedback. Pair group-hover: with group-active: (docs/design.md → Where Shinsa differs, 15)',
  },
  {
    pattern: /(?:^|[\s'"`])rounded-xl border border-border bg-card\b/,
    unless: /^$/,
    message:
      'A hand-built card. Use CARD from components/surface.ts (docs/design.md → Where Shinsa differs, 15)',
  },
  {
    pattern: /IconCheck[^\n]*-green-|-green-[^\n]*IconCheck/,
    unless: /^$/,
    message:
      "A green checkmark. Checkmarks are the accent (only the progress track's done steps are green): CheckMark / CHECK_TEXT from components/check-mark.tsx",
  },
];

const CORNER_CHECK_ROOTS = ['packages/ui/src', 'apps/web/src'];

const RAW_CORNER = /(?:^|[\s:'"`])(?:[a-z]+:)*rounded(?:-[trblse]{1,2})?-\[(?!inherit\])/;

const CORNER_MESSAGE =
  'Raw corner. Corners come from the radius tokens, and a nested corner is concentric: inner = outer − padding. Use rounded-control / -control-sm / -popup / -item / -segment (globals.css → Corners), or add a derived token there';

const FOCUS_CHECK_ROOTS = ['packages/ui/src', 'apps/web/src'];

const FOCUS_STATE =
  /(?:^|[\s'"`])[^\s'"`]*\b(?:focus|focus-visible|focus-within)(?:\/[\w-]+)?:(?=[^\s'"`])|(?:^|[\s'"`:])ring-offset-/;

const FOCUS_MESSAGE =
  'Focus state. Shinsa draws no focus rings, outlines or focus washes; keep outline-none (docs/design.md → No focus states)';

const TIME_CHECK_ROOTS = ['apps/web/src'];

const TIME_COMPONENT_FILE = 'apps/web/src/components/time-ago.tsx';

const TIME_FORMATTERS = new Set(['formatAge', 'formatDuration']);

const TIME_COMPONENTS = new Set(['TimeAgo', 'Duration']);

const TIME_MESSAGE =
  'A time rendered without its tooltip. Render it through TimeAgo or Duration (components/time-ago.tsx), so hovering shows the exact time (docs/design.md → Where Shinsa differs, 13)';

const ALLOWED_COMMENT_PATTERN = /^\s*(biome-ignore|@ts-|\/\s*<reference|\/v1\/|#region|#endregion)/;

function readSource(file: string): string {
  return readFileSync(file, 'utf8');
}

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

function isRouteTable(file: string): boolean {
  return file.endsWith('/modules/index.ts') || file.endsWith('/modules/v1/index.ts');
}

function collectCommentViolations(file: string, comments: BabelComment[], violations: Violation[]): void {
  for (const comment of comments) {
    const inner = comment.value.trim();
    if (inner.length === 0 || ALLOWED_COMMENT_PATTERN.test(inner)) continue;

    violations.push({
      file,
      line: comment.loc.start.line,
      message: `Comment found — names and structure carry the meaning, docs/ carries the rest: "${inner.slice(0, 60)}"`,
    });
  }
}

function declaredFunctionName(node: BabelNode): { name: string; line: number } | null {
  if (node.type === 'FunctionDeclaration') {
    const id = node.id as BabelNode & { name: string };
    if (id?.name) return { name: id.name, line: id.loc?.start.line ?? 0 };
  }

  if (node.type === 'ClassMethod' || node.type === 'ObjectMethod') {
    const key = node.key as BabelNode & { name?: string };
    if (key?.type === 'Identifier' && key.name) {
      return { name: key.name, line: key.loc?.start.line ?? 0 };
    }
  }

  if (node.type === 'VariableDeclarator') {
    const id = node.id as BabelNode & { name?: string };
    const init = node.init as BabelNode | null;
    const isFunction = init?.type === 'ArrowFunctionExpression' || init?.type === 'FunctionExpression';
    if (id?.type === 'Identifier' && id.name && isFunction) {
      return { name: id.name, line: id.loc?.start.line ?? 0 };
    }
  }

  return null;
}

function walk(node: BabelNode, visit: (node: BabelNode) => void): void {
  visit(node);

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child === 'object' && 'type' in child) walk(child as BabelNode, visit);
      }
      continue;
    }
    if (value && typeof value === 'object' && 'type' in value) walk(value as BabelNode, visit);
  }
}

function collectVerbViolations(file: string, program: BabelNode, violations: Violation[]): void {
  walk(program, (node) => {
    const declaration = declaredFunctionName(node);
    if (!declaration) return;
    if (!BANNED_VERB_PATTERN.test(declaration.name)) return;
    if (BANNED_VERB_ALLOWLIST.has(declaration.name)) return;

    violations.push({
      file,
      line: declaration.line,
      message: `Banned verb prefix on "${declaration.name}" — use the catalog: find*/select*/list*/count*/request*/resolve*/create*/update*/upsert*/write*/replace*/softDelete*/remove*/assert*/serialize*/mask*/apply*/record*/sync* (see the conventions skill)`,
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

function walkWithAncestors(
  node: BabelNode,
  ancestors: BabelNode[],
  visit: (node: BabelNode, ancestors: BabelNode[]) => void
): void {
  visit(node, ancestors);
  const next = [...ancestors, node];
  for (const value of Object.values(node)) {
    const children = Array.isArray(value) ? value : [value];
    for (const child of children) {
      if (child && typeof child === 'object' && 'type' in child)
        walkWithAncestors(child as BabelNode, next, visit);
    }
  }
}

function collectTimeViolations(file: string, program: BabelNode, violations: Violation[]): void {
  walkWithAncestors(program, [], (node, ancestors) => {
    if (isUntimedFormatter(node, ancestors)) {
      violations.push({ file, line: node.loc?.start.line ?? 0, message: TIME_MESSAGE });
    }
  });
}

function collectClassViolations(file: string, source: string, violations: Violation[]): void {
  source.split('\n').forEach((line, index) => {
    for (const { pattern, message } of BANNED_CLASSES) {
      if (pattern.test(line)) violations.push({ file, line: index + 1, message });
    }
    for (const { pattern, unless, message } of PAIRED_CLASSES) {
      if (pattern.test(line) && !unless.test(line)) violations.push({ file, line: index + 1, message });
    }
  });
}

function isClassChecked(file: string): boolean {
  return (
    file.endsWith('.tsx') &&
    CLASS_CHECK_ROOTS.some((root) => file.startsWith(root)) &&
    !CLASS_CHECK_EXCLUDED_ROOTS.some((root) => file.startsWith(root))
  );
}

function checkFile(file: string, violations: Violation[]): void {
  const source = readSource(file);
  let parsed: { program: BabelNode; comments?: BabelComment[] | null };
  try {
    parsed = parse(source, {
      sourceType: 'module',
      plugins: file.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'],
      attachComment: false,
    }) as unknown as { program: BabelNode; comments?: BabelComment[] | null };
  } catch (error) {
    violations.push({
      file,
      line: 1,
      message: `Could not parse: ${error instanceof Error ? error.message : String(error)}`,
    });
    return;
  }

  if (!isRouteTable(file) && !COMMENT_CHECK_EXCLUDED_ROOTS.some((excluded) => file.startsWith(excluded))) {
    collectCommentViolations(file, parsed.comments ?? [], violations);
  }
  if (isClassChecked(file)) {
    collectClassViolations(file, source, violations);
  }
  if (file.endsWith('.tsx') && CORNER_CHECK_ROOTS.some((root) => file.startsWith(root))) {
    source.split('\n').forEach((line, index) => {
      if (RAW_CORNER.test(line)) violations.push({ file, line: index + 1, message: CORNER_MESSAGE });
    });
  }
  if (
    file.endsWith('.tsx') &&
    FOCUS_CHECK_ROOTS.some((root) => file.startsWith(root)) &&
    !CLASS_CHECK_EXCLUDED_ROOTS.some((root) => file.startsWith(root))
  ) {
    source.split('\n').forEach((line, index) => {
      if (FOCUS_STATE.test(line)) violations.push({ file, line: index + 1, message: FOCUS_MESSAGE });
    });
  }
  if (
    file.endsWith('.tsx') &&
    file !== TIME_COMPONENT_FILE &&
    TIME_CHECK_ROOTS.some((root) => file.startsWith(root))
  ) {
    collectTimeViolations(file, parsed.program, violations);
  }
  if (VERB_CHECK_ROOTS.some((verbRoot) => file.startsWith(verbRoot))) {
    collectVerbViolations(file, parsed.program, violations);
  }
}

function run(): void {
  const violations: Violation[] = [];

  for (const root of ROOTS.filter((candidate) => existsSync(candidate))) {
    for (const file of listSourceFiles(root)) {
      checkFile(file, violations);
    }
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
