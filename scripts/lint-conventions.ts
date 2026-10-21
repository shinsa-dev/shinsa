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

const ROOTS = ['apps/cli/src', 'apps/cli/test', 'apps/web/src', 'packages', 'scripts'];

const SKIPPED_SEGMENTS = new Set(['node_modules', '.types', 'dist', '.wrangler', 'generated']);

const BANNED_VERB_PATTERN = /^(get|fetch|load|set|delete|destroy)[A-Z]/;

const BANNED_VERB_ALLOWLIST = new Set<string>([]);

const VERB_CHECK_ROOTS = ['apps/cli/src', 'apps/web/src', 'packages/core'];

const COMMENT_CHECK_EXCLUDED_ROOTS = ['packages/ui', 'apps/web/src/features/ui'];

const CLASS_CHECK_ROOTS = ['apps/web/src'];

const CLASS_CHECK_EXCLUDED_ROOTS = ['apps/web/src/features/ui'];

const BANNED_CLASSES: { pattern: RegExp; message: string }[] = [
  {
    pattern: /(?:^|[\s:'"`])text-\[\d/,
    message: 'Raw font size; use a type role (docs/design.md → Sizing → Type roles)',
  },
  {
    pattern: /(?:^|[\s:'"`])rounded(?:-[trblse]{1,2})?-\[\d/,
    message: 'Raw corner; there is one 3px corner (rounded-*), plus rounded-full',
  },
  {
    pattern: /(?:^|[\s:'"`])font-(?:thin|extralight|light|bold|extrabold|black)\b/,
    message: 'Weights are 400, 500 (font-medium) and 600 (font-semibold) for inline strong only',
  },
  {
    pattern: /(?:^|[\s:'"`])(?:shadow|ring)-(?!0\b)[a-z0-9[]/,
    message: 'No shadows and no rings; depth is the surface steps, focus recolours the border',
  },
];

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

function collectClassViolations(file: string, source: string, violations: Violation[]): void {
  source.split('\n').forEach((line, index) => {
    for (const { pattern, message } of BANNED_CLASSES) {
      if (pattern.test(line)) violations.push({ file, line: index + 1, message });
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
