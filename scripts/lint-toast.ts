import { parse } from '@babel/parser';
import { TOAST_LIMIT, TOAST_MESSAGE, TOAST_PLACEHOLDER_LENGTH } from './lint-rules.ts';

type Node = { type: string; loc?: { start: { line: number } }; [key: string]: unknown };

type Text = { file: string; line: number; length: number };

type Source = { file: string; program: Node; constants: Map<string, Node> };

type Definition = { source: Source; params: string[]; returns: Node[] };

type Context = { source: Source; definitions: Map<string, Definition[]>; seen: Set<Node> };

const TOAST_METHODS = new Set(['success', 'error', 'info', 'warning', 'message', 'loading']);

const TOAST_HELPERS = new Map([
  ['confirmDone', 0],
  ['requestWithToast', 1],
  ['sendCommandWithToast', 1],
]);

const TOAST_NAMES = new Set(['done', 'sent']);

const TOAST_OPTIONS = ['title', 'description'];

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ObjectMethod',
]);

function children(node: Node): Node[] {
  return Object.values(node).flatMap((value) =>
    (Array.isArray(value) ? value : [value]).filter(
      (child): child is Node => Boolean(child) && typeof child === 'object' && 'type' in child
    )
  );
}

function visit(node: Node, onNode: (node: Node) => void) {
  onNode(node);
  for (const child of children(node)) visit(child, onNode);
}

function readName(node: unknown) {
  const named = node as { type?: string; name?: string; value?: unknown } | null;
  if (named?.type === 'Identifier') return named.name ?? null;
  if (named?.type === 'StringLiteral' && typeof named.value === 'string') return named.value;
  return null;
}

function readParam(node: Node) {
  return readName(node.type === 'AssignmentPattern' ? node.left : node) ?? '';
}

function unwrap(node: Node): Node {
  if (
    node.type === 'TSAsExpression' ||
    node.type === 'TSSatisfiesExpression' ||
    node.type === 'TSNonNullExpression'
  )
    return unwrap(node.expression as Node);
  return node;
}

function listReturns(fn: Node) {
  const body = fn.body as Node;
  if (body.type !== 'BlockStatement') return [body];
  const returns: Node[] = [];
  const walk = (node: Node) => {
    if (node.type === 'ReturnStatement' && node.argument) returns.push(node.argument as Node);
    for (const child of children(node)) if (!FUNCTION_TYPES.has(child.type)) walk(child);
  };
  walk(body);
  return returns;
}

function readFunction(node: Node): [string, Node] | null {
  if (node.type === 'FunctionDeclaration') return node.id ? [readName(node.id) ?? '', node] : null;
  if (node.type === 'ObjectMethod') return [readName(node.key) ?? '', node];
  const [key, value] =
    node.type === 'VariableDeclarator'
      ? [node.id, node.init]
      : node.type === 'ObjectProperty'
        ? [node.key, node.value]
        : [];
  const name = readName(key);
  const fn = value as Node | null | undefined;
  return name && fn && FUNCTION_TYPES.has(fn.type) ? [name, fn] : null;
}

function readSource(file: string, text: string): Source {
  const program = parse(text, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
    .program as unknown as Node;
  const constants = new Map<string, Node>();
  visit(program, (node) => {
    const name = node.type === 'VariableDeclarator' ? readName(node.id) : null;
    if (name && node.init) constants.set(name, node.init as Node);
  });
  return { file, program, constants };
}

function indexDefinitions(sources: Source[]) {
  const definitions = new Map<string, Definition[]>();
  for (const source of sources) {
    visit(source.program, (node) => {
      const found = readFunction(node);
      if (!found?.[0]) return;
      const [name, fn] = found;
      const definition = { source, params: (fn.params as Node[]).map(readParam), returns: listReturns(fn) };
      definitions.set(name, [...(definitions.get(name) ?? []), definition]);
    });
  }
  return definitions;
}

function readProperty(object: Node, key: string) {
  const property = (object.properties as Node[]).find(
    (candidate) => candidate.type === 'ObjectProperty' && readName(candidate.key) === key
  );
  return (property?.value as Node | undefined) ?? null;
}

function listValues(object: Node) {
  return (object.properties as Node[]).flatMap((property) =>
    property.type === 'ObjectProperty' ? [property.value as Node] : []
  );
}

function readCalleeName(callee: Node) {
  return readName(callee.type === 'MemberExpression' ? callee.property : callee);
}

function resolveMember(expression: Node, context: Context) {
  const found = context.source.constants.get(readName(expression.object) ?? '');
  const owner = found ? unwrap(found) : null;
  if (owner?.type !== 'ObjectExpression') return [];
  if (expression.computed) return listValues(owner);
  const value = readProperty(owner, readName(expression.property) ?? '');
  return value ? [value] : [];
}

function resolveTexts(node: Node | null, context: Context): Text[] {
  if (!node || context.seen.has(node)) return [];
  context.seen.add(node);
  const at = { file: context.source.file, line: node.loc?.start.line ?? 0 };
  const expression = unwrap(node);
  const resolve = (next: Node | null) => resolveTexts(next, context);
  switch (expression.type) {
    case 'StringLiteral':
      return [{ ...at, length: (expression.value as string).length }];
    case 'TemplateLiteral': {
      const parts = expression.quasis as { value: { cooked: string | null; raw: string } }[];
      const fixed = parts.reduce((sum, part) => sum + (part.value.cooked ?? part.value.raw).length, 0);
      const inserted = (expression.expressions as Node[]).length * TOAST_PLACEHOLDER_LENGTH;
      return [{ ...at, length: fixed + inserted }];
    }
    case 'ConditionalExpression':
      return [...resolve(expression.consequent as Node), ...resolve(expression.alternate as Node)];
    case 'LogicalExpression':
      return [...resolve(expression.left as Node), ...resolve(expression.right as Node)];
    case 'BinaryExpression': {
      if (expression.operator !== '+') return [];
      const longest = (texts: Text[]) =>
        Math.max(TOAST_PLACEHOLDER_LENGTH, ...texts.map((text) => text.length));
      return [
        {
          ...at,
          length: longest(resolve(expression.left as Node)) + longest(resolve(expression.right as Node)),
        },
      ];
    }
    case 'Identifier':
      return resolve(context.source.constants.get(expression.name as string) ?? null);
    case 'MemberExpression':
      return resolveMember(expression, context).flatMap(resolve);
    case 'ObjectExpression':
      return TOAST_OPTIONS.flatMap((key) => resolve(readProperty(expression, key)));
    case 'CallExpression':
      return (context.definitions.get(readCalleeName(expression.callee as Node) ?? '') ?? []).flatMap(
        (definition) =>
          definition.returns.flatMap((value) =>
            resolveTexts(value, { ...context, source: definition.source })
          )
      );
    default:
      return [];
  }
}

function listCallArguments(node: Node, definitions: Map<string, Definition[]>) {
  const callee = node.callee as Node;
  const args = node.arguments as Node[];
  if (callee.type === 'MemberExpression' && readName(callee.object) === 'toast')
    return TOAST_METHODS.has(readName(callee.property) ?? '') ? args.slice(0, 2) : [];
  const name = readCalleeName(callee) ?? '';
  if (callee.type === 'Identifier' && name === 'toast') return args.slice(0, 2);
  const helper = TOAST_HELPERS.get(name);
  if (helper !== undefined) return args.slice(helper, helper + 1);
  const positions = new Set(
    (definitions.get(name) ?? []).flatMap((definition) =>
      definition.params.flatMap((param, index) => (TOAST_NAMES.has(param) ? [index] : []))
    )
  );
  return [...positions].flatMap((index) => (args[index] ? [args[index]] : []));
}

function listToastArguments(node: Node, definitions: Map<string, Definition[]>): Node[] {
  if (node.type === 'ObjectProperty' && TOAST_NAMES.has(readName(node.key) ?? ''))
    return [node.value as Node];
  return node.type === 'CallExpression' ? listCallArguments(node, definitions) : [];
}

export function listToastViolations(
  files: Record<string, string>
): { file: string; line: number; message: string }[] {
  const sources = Object.entries(files).map(([file, text]) => readSource(file, text));
  const definitions = indexDefinitions(sources);
  const found = new Map<string, { file: string; line: number }>();
  for (const source of sources) {
    visit(source.program, (node) => {
      for (const argument of listToastArguments(node, definitions)) {
        for (const text of resolveTexts(argument, { source, definitions, seen: new Set() })) {
          if (text.length > TOAST_LIMIT)
            found.set(`${text.file}:${text.line}`, { file: text.file, line: text.line });
        }
      }
    });
  }
  return [...found.values()]
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
    .map((at) => ({ ...at, message: TOAST_MESSAGE }));
}
