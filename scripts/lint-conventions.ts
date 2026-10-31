import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse } from '@babel/parser';
import { listDisclosureViolations } from './lint-disclosure.ts';
import {
  APP,
  APP_AND_KIT,
  BANNED_ICON_MESSAGE,
  BANNED_ICON_PATTERN,
  BANNED_VERB_PATTERN,
  CATALOG,
  CLASS_RULES,
  type ClassRule,
  ECHO_TOOLTIP_MESSAGE,
  GREEN_MESSAGE,
  ICON_BRIGHTER_MESSAGE,
  ICON_FADE_MESSAGE,
  ICON_SIZE_MESSAGE,
  LONE_OPTION_MESSAGE,
  OWN_HIGHLIGHT_MESSAGE,
  RAW_SVG_MESSAGE,
  SHORTCUT_MESSAGE,
  STRETCHED_TRIGGER_MESSAGE,
  TAB_BAR_MESSAGE,
  TIME_MESSAGE,
  TOOLTIP_DELAY_MESSAGE,
  VERB_CATALOG,
} from './lint-rules.ts';
import { RAW_SELECTION_MESSAGE, RAW_SELECTION_PATTERN } from './lint-selection.ts';

type Violation = { file: string; line: number; message: string };

type BabelComment = { type: string; value: string; loc: { start: { line: number } } };

type BabelNode = {
  type: string;
  loc?: { start: { line: number } };
  [key: string]: unknown;
};

const ROOTS = [
  'apps/engine/src',
  'apps/engine/test',
  'apps/web/src',
  'apps/web/test',
  'apps/desktop/src',
  'apps/desktop/test',
  'apps/marketing/src',
  'packages',
  'scripts',
];

const SKIPPED_SEGMENTS = new Set(['node_modules', 'dist']);

const REACT_LIFECYCLE_NAMES = new Set([
  'getDerivedStateFromError',
  'getDerivedStateFromProps',
  'getSnapshotBeforeUpdate',
]);

const VERB_CHECK_ROOTS = [
  'apps/engine/src',
  'apps/web/src',
  'apps/desktop/src',
  'apps/marketing/src',
  'packages/core',
];

const COMMENT_CHECK_EXCLUDED_ROOTS = ['packages/ui'];

const ALLOWED_COMMENT_PATTERN = /^\s*(biome-ignore|@ts-)/;

const SVG_DRAWERS = ['icon/index.tsx', 'spinner.tsx', 'logo.tsx', 'area-chart.tsx'].map(
  (name) => `packages/ui/src/components/${name}`
);

const ICON_ELEMENTS = new Set(['Icon', 'Spinner', 'Logo', 'PriorityIcon', 'CheckMark', 'SelectedMark']);

const ICON_SIZE_CLASS = /(?:^|\s)(?:[\w/-]+:)*(?:size|w|h)-[\w.()-]+(?=\s|$)/;

const TEXT_STEP: Record<string, number> = {
  foreground: 4,
  'card-foreground': 4,
  'popover-foreground': 4,
  'muted-foreground': 2,
};

const OWN_TEXT_STEP =
  /(?:^|\s)text-(?:fg|icon)-([1-4])(?=\s|$)|(?:^|\s)text-((?:card-|popover-|muted-)?foreground)(?=\s|$)/;

const TAB_ROLES = new Set(['tab', 'tablist']);

const TAB_PRIMITIVE = '@base-ui/react/tabs';

const PICKED_ROLES = new Set(['option', 'menuitem', 'menuitemradio', 'menuitemcheckbox']);

const HIGHLIGHT_LISTS = new Set(['HighlightList', 'HoverHighlight']);

const OWN_ROW_BACKGROUND =
  /(?:^|\s)(?:[\w-]+:)*(?:hover|active|data-selected|aria-selected|data-\[selected=true\]|data-active|data-\[active=true\]):bg-/;

const FADED_ICON = /(?:^|\s)(?:[\w/-]+:)*opacity-(?!(?:0|100)(?:\s|$))\S+/;

const CHECKMARK_ICON = /^IconCheck(?:mark|Circle)/;

const GREEN_CLASS = /(?:^|\s)(?:\S+:)?[a-z]+-(?:green(?:-\d+)?|success)(?:\/\d+)?(?=\s|$)/;

const TOOLTIP_WRAPPERS = new Set(['Hint', 'TooltipTrigger']);

const BLOCK_TAG = /^(?:div|p|section|article|header|footer|nav|form|label|li|ul|ol|h[1-6])$/;

const BLOCK_DISPLAY = /(?:^|\s)(?:flex|grid|block|table)(?=\s|$)/;

const FITTED_WIDTH =
  /(?:^|\s)(?:w-fit|w-max|w-\d[\w.]*|size-[\w.]+|inline|inline-flex|inline-grid|inline-block)(?=\s|$)/;

const TOOLTIP_PARTS = new Set(['Hint', 'Tooltip', 'TooltipProvider', 'TooltipTrigger', 'TooltipContent']);

const SHORTCUT_FILES = [
  'apps/web/src/hooks/use-command-key.ts',
  'apps/web/src/hooks/use-code-keys.ts',
  'apps/web/src/hooks/use-review-keys.ts',
  'apps/web/src/hooks/use-terminal-keys.ts',
];

const TIME_CHECK_ROOTS = ['apps/web/src'];

const TIME_COMPONENT_FILE = 'apps/web/src/components/text/time-ago.tsx';

const TIME_FORMATTERS = new Set(['formatAge', 'formatDuration']);

const TIME_COMPONENTS = new Set(['TimeAgo', 'Duration']);

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

function listStyleSheets(root: string): string[] {
  return readdirSync(root, { recursive: true })
    .map((entry) => join(root, String(entry)))
    .filter((path) => path.endsWith('.css'));
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
    if (node.type === 'ClassMethod' && REACT_LIFECYCLE_NAMES.has(declaration.name)) return;
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

function readTagName(node: BabelNode) {
  return (node.name as BabelNode & { name?: string }).name ?? '';
}

function isIconElement(node: BabelNode) {
  if (node.type !== 'JSXOpeningElement') return false;
  const name = readTagName(node);
  return ICON_ELEMENTS.has(name) || name.endsWith('Chevron');
}

function isFadedIcon(node: BabelNode) {
  if (!isIconElement(node)) return false;
  return hasValue(readProps(node), 'className', (value) => FADED_ICON.test(value));
}

function isClassSizedIcon(node: BabelNode) {
  if (!isIconElement(node) || readTagName(node) === 'Logo') return false;
  return hasValue(readProps(node), 'className', (value) => ICON_SIZE_CLASS.test(value));
}

function readTextStep(classes: string[]) {
  for (const value of classes) {
    const match = OWN_TEXT_STEP.exec(value);
    if (match) return match[1] ? Number(match[1]) : (TEXT_STEP[match[2] ?? ''] ?? null);
  }
  return null;
}

function readElementStep(element: BabelNode) {
  return readTextStep(readProps(element.openingElement as BabelNode).get('className') ?? []);
}

function readRowStep(row: BabelNode, icon: BabelNode) {
  let step = readElementStep(row) ?? 0;
  walk(row, (child) => {
    if (child.type !== 'JSXElement' || child.openingElement === icon) return;
    step = Math.max(step, readElementStep(child) ?? 0);
  });
  return step;
}

function isBrighterIcon(node: BabelNode, ancestors: BabelNode[]) {
  if (!isIconElement(node)) return false;
  const own = readTextStep(readProps(node).get('className') ?? []);
  if (own === null) return false;
  const elements = ancestors
    .filter((ancestor) => ancestor.type === 'JSXElement')
    .slice(0, -1)
    .reverse();
  const row = elements.find((element) => readElementStep(element) !== null);
  return row !== undefined && own > readRowStep(row, node);
}

function isRawSvg(file: string, node: BabelNode) {
  if (node.type !== 'JSXOpeningElement' || SVG_DRAWERS.includes(file)) return false;
  return (node.name as BabelNode & { name?: string }).name === 'svg';
}

function selectTriggerElement(node: BabelNode): BabelNode | null {
  if (node.type !== 'JSXElement') return null;
  const wrapper = readElementName(node);
  if (!wrapper || !TOOLTIP_WRAPPERS.has(wrapper)) return null;
  if (wrapper === 'Hint') {
    return (node.children as BabelNode[]).find((child) => child.type === 'JSXElement') ?? null;
  }
  const attributes = (node.openingElement as BabelNode).attributes as BabelNode[];
  const render = attributes.find((attribute) => readKey(attribute) === 'render');
  const expression = (render?.value as BabelNode | undefined)?.expression as BabelNode | undefined;
  return expression?.type === 'JSXElement' ? expression : null;
}

function isStretchedTrigger(node: BabelNode) {
  const element = selectTriggerElement(node);
  const tag = element ? readElementName(element) : null;
  if (!element || !tag || tag !== tag.toLowerCase()) return false;
  const classes = (readProps(element.openingElement as BabelNode).get('className') ?? []).join(' ');
  if (!BLOCK_TAG.test(tag) && !BLOCK_DISPLAY.test(classes)) return false;
  return !FITTED_WIDTH.test(classes);
}

function isTooltipDelay(node: BabelNode) {
  if (node.type === 'JSXOpeningElement') {
    const name = (node.name as BabelNode & { name?: string }).name ?? '';
    return TOOLTIP_PARTS.has(name) && readProps(node).has('delay');
  }
  if (node.type !== 'CallExpression') return false;
  if ((node.callee as BabelNode & { name?: string }).name !== 'useTooltipTrigger') return false;
  const options = (node.arguments as BabelNode[])[1];
  return options?.type === 'ObjectExpression' && readProps(options).has('delay');
}

function readReference(node: BabelNode | null | undefined): string | null {
  if (!node) return null;
  if (node.type === 'JSXExpressionContainer') return readReference(node.expression as BabelNode);
  if (node.type === 'StringLiteral') return `"${String(node.value).replace(/\s+/g, ' ').trim()}"`;
  if (node.type === 'Identifier') return String(node.name);
  if (node.type !== 'MemberExpression' || node.computed) return null;
  const object = readReference(node.object as BabelNode);
  const property = (node.property as BabelNode & { name?: string }).name;
  return object && property ? `${object}.${property}` : null;
}

function readShownText(children: BabelNode[]): string | null {
  const parts: (string | null)[] = [];
  const collect = (nodes: BabelNode[]) => {
    for (const node of nodes) {
      if (node.type === 'JSXText') {
        const text = String(node.value).replace(/\s+/g, ' ').trim();
        if (text) parts.push(`"${text}"`);
      } else if (node.type === 'JSXExpressionContainer') {
        if (node.expression && (node.expression as BabelNode).type !== 'JSXEmptyExpression')
          parts.push(readReference(node));
      } else if (node.type === 'JSXElement' || node.type === 'JSXFragment') {
        collect(node.children as BabelNode[]);
      }
    }
  };
  collect(children);
  return parts.length === 1 ? (parts[0] ?? null) : null;
}

function listElementChildren(node: BabelNode) {
  return (node.children as BabelNode[]).filter((child) => child.type === 'JSXElement');
}

function readTooltipPair(node: BabelNode): [string | null, BabelNode | undefined] {
  const wrapper = readElementName(node);
  if (wrapper === 'Hint') {
    const attributes = (node.openingElement as BabelNode).attributes as BabelNode[];
    const extra = attributes.some((attribute) => ['shortcut', 'detail'].includes(readKey(attribute) ?? ''));
    if (extra) return [null, undefined];
    const label = attributes.find((attribute) => readKey(attribute) === 'label');
    return [readReference(label?.value as BabelNode | undefined), listElementChildren(node)[0]];
  }
  if (wrapper !== 'Tooltip') return [null, undefined];
  const parts = listElementChildren(node);
  const content = parts.find((part) => readElementName(part) === 'TooltipContent');
  const trigger = parts.find((part) => readElementName(part) === 'TooltipTrigger');
  return [content ? readShownText(content.children as BabelNode[]) : null, trigger];
}

function isEchoTooltip(node: BabelNode) {
  if (node.type !== 'JSXElement') return false;
  const [tooltip, trigger] = readTooltipPair(node);
  if (!tooltip || !trigger) return false;
  return readShownText(trigger.children as BabelNode[])?.toLowerCase() === tooltip.toLowerCase();
}

function isGlobalKeyListener(node: BabelNode) {
  if (node.type !== 'CallExpression') return false;
  const callee = node.callee as BabelNode & { name?: string; property?: BabelNode & { name?: string } };
  const name = callee.type === 'MemberExpression' ? callee.property?.name : callee.name;
  if (name !== 'addEventListener') return false;
  const [event] = node.arguments as (BabelNode & { value?: unknown })[];
  return event?.type === 'StringLiteral' && (event.value === 'keydown' || event.value === 'keyup');
}

function isHandRolledTabBar(node: BabelNode) {
  if (node.type === 'ImportDeclaration')
    return (node.source as BabelNode & { value?: string }).value === TAB_PRIMITIVE;
  if (node.type !== 'JSXAttribute' || readKey(node) !== 'role') return false;
  return listStrings(node.value as BabelNode | null).some((value) => TAB_ROLES.has(value));
}

function isPickedRow(props: Map<string, string[]>) {
  return props.has('data-highlight-item') || hasValue(props, 'role', (value) => PICKED_ROLES.has(value));
}

function isSelfHighlightedRow(node: BabelNode) {
  if (node.type !== 'JSXOpeningElement') return false;
  const props = readProps(node);
  return isPickedRow(props) && hasValue(props, 'className', (value) => OWN_ROW_BACKGROUND.test(value));
}

function isLoneOption(node: BabelNode, ancestors: BabelNode[]) {
  if (node.type !== 'JSXOpeningElement') return false;
  if (!hasValue(readProps(node), 'role', (value) => PICKED_ROLES.has(value))) return false;
  return !ancestors.some((ancestor) => HIGHLIGHT_LISTS.has(readElementName(ancestor) ?? ''));
}

function collectSyntaxViolations(file: string, program: BabelNode, violations: Violation[]): void {
  const timed = file.endsWith('.tsx') && file !== TIME_COMPONENT_FILE && isUnder(file, TIME_CHECK_ROOTS);
  const styled = isUnder(file, APP_AND_KIT) && !CATALOG.includes(file);
  const app = isUnder(file, APP);
  const keyed = app && !SHORTCUT_FILES.includes(file);
  const tipped = isUnder(file, APP_AND_KIT);
  walk(program, (node, ancestors) => {
    const line = node.loc?.start.line ?? 0;
    if (tipped) for (const message of listTooltipMessages(node)) violations.push({ file, line, message });
    if (keyed && isGlobalKeyListener(node)) violations.push({ file, line, message: SHORTCUT_MESSAGE });
    if (app && isHandRolledTabBar(node)) violations.push({ file, line, message: TAB_BAR_MESSAGE });
    if (app && isLoneOption(node, ancestors)) violations.push({ file, line, message: LONE_OPTION_MESSAGE });
    if (timed && isUntimedFormatter(node, ancestors)) violations.push({ file, line, message: TIME_MESSAGE });
    if (timed && isStretchedTrigger(node))
      violations.push({ file, line, message: STRETCHED_TRIGGER_MESSAGE });
    if (!styled) return;
    for (const message of listStyleMessages(file, node, ancestors)) violations.push({ file, line, message });
  });
}

function listTooltipMessages(node: BabelNode) {
  const checks: [boolean, string][] = [
    [isTooltipDelay(node), TOOLTIP_DELAY_MESSAGE],
    [isEchoTooltip(node), ECHO_TOOLTIP_MESSAGE],
  ];
  return checks.filter(([broken]) => broken).map(([, message]) => message);
}

function listStyleMessages(file: string, node: BabelNode, ancestors: BabelNode[]) {
  const checks: [boolean, string][] = [
    [isSelfHighlightedRow(node), OWN_HIGHLIGHT_MESSAGE],
    [isFadedIcon(node), ICON_FADE_MESSAGE],
    [isClassSizedIcon(node), ICON_SIZE_MESSAGE],
    [isBrighterIcon(node, ancestors), ICON_BRIGHTER_MESSAGE],
    [isRawSvg(file, node), RAW_SVG_MESSAGE],
    [isGreenCheckmark(node, ancestors), GREEN_MESSAGE],
  ];
  return checks.filter(([broken]) => broken).map(([, message]) => message);
}

function isRuleBroken(rule: ClassRule, file: string, line: string) {
  if (file === rule.allowedIn || !isUnder(file, rule.roots)) return false;
  if (CATALOG.includes(file) && !rule.inCatalog) return false;
  return rule.pattern.test(line) && !rule.unless?.test(line);
}

function collectRawSelection(file: string, source: string, violations: Violation[]): void {
  if (!isUnder(file, APP)) return;
  source.split('\n').forEach((line, index) => {
    if (RAW_SELECTION_PATTERN.test(line))
      violations.push({ file, line: index + 1, message: RAW_SELECTION_MESSAGE });
  });
}

function collectBannedIcons(file: string, source: string, violations: Violation[]): void {
  if (!isUnder(file, APP_AND_KIT)) return;
  source.split('\n').forEach((line, index) => {
    if (BANNED_ICON_PATTERN.test(line))
      violations.push({ file, line: index + 1, message: BANNED_ICON_MESSAGE });
  });
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
  collectRawSelection(file, source, violations);
  collectBannedIcons(file, source, violations);
  collectClassViolations(file, source, violations);
  collectSyntaxViolations(file, parsed.program, violations);
  if (file.endsWith('.tsx') && isUnder(file, APP)) {
    for (const violation of listDisclosureViolations(source)) violations.push({ file, ...violation });
  }
  if (isUnder(file, VERB_CHECK_ROOTS)) collectVerbViolations(file, parsed.program, violations);
}

function run(): void {
  const violations: Violation[] = [];
  for (const root of ROOTS.filter((candidate) => existsSync(candidate))) {
    for (const file of listSourceFiles(root)) checkFile(file, violations);
  }
  for (const sheet of APP.flatMap((root) => listStyleSheets(root)))
    collectRawSelection(sheet, readFileSync(sheet, 'utf8'), violations);
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
