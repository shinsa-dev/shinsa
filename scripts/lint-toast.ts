import { parse } from '@babel/parser';
import { type AstNode, listChildren, visit } from './lint-ast.ts';
import {
  TOAST_LIMIT,
  TOAST_MESSAGE,
  TOAST_PASSTHROUGH,
  TOAST_PLACEHOLDER_LENGTH,
  TOAST_UNCHECKED_MESSAGE,
} from './lint-rules.ts';

type Text = { file: string; line: number; length: number | null };

type Source = {
  file: string;
  program: AstNode;
  constants: Map<string, AstNode>;
  imports: Map<string, string>;
};

type Definition = { source: Source; params: string[]; returns: AstNode[] };

type Exported = { source: Source; value: AstNode };

type Index = { definitions: Map<string, Definition[]>; exported: Map<string, Exported[]> };

type Context = Index & { source: Source; seen: Set<AstNode> };

type Argument = { node: AstNode; strict: boolean };

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

const NOT_TEXT = new Set([...FUNCTION_TYPES, 'BooleanLiteral', 'NullLiteral', 'NumericLiteral']);

const SERVER_TEXT = 'message';

const PASSED_ON = new Set([...TOAST_NAMES, SERVER_TEXT, 'undefined']);

function readName(node: unknown) {
  const named = node as { type?: string; name?: string; value?: unknown } | null;
  if (named?.type === 'Identifier') return named.name ?? null;
  if (named?.type === 'StringLiteral' && typeof named.value === 'string') return named.value;
  return null;
}

function readParam(node: AstNode) {
  return readName(node.type === 'AssignmentPattern' ? node.left : node) ?? '';
}

function unwrap(node: AstNode): AstNode {
  if (
    node.type === 'TSAsExpression' ||
    node.type === 'TSSatisfiesExpression' ||
    node.type === 'TSNonNullExpression'
  )
    return unwrap(node.expression as AstNode);
  return node;
}

function listReturns(fn: AstNode) {
  const body = fn.body as AstNode;
  if (body.type !== 'BlockStatement') return [body];
  const returns: AstNode[] = [];
  const walk = (node: AstNode) => {
    if (node.type === 'ReturnStatement' && node.argument) returns.push(node.argument as AstNode);
    for (const child of listChildren(node)) if (!FUNCTION_TYPES.has(child.type)) walk(child);
  };
  walk(body);
  return returns;
}

function readFunction(node: AstNode): [string, AstNode] | null {
  if (node.type === 'FunctionDeclaration') return node.id ? [readName(node.id) ?? '', node] : null;
  if (node.type === 'ObjectMethod') return [readName(node.key) ?? '', node];
  const [key, value] =
    node.type === 'VariableDeclarator'
      ? [node.id, node.init]
      : node.type === 'ObjectProperty'
        ? [node.key, node.value]
        : [];
  const name = readName(key);
  const fn = value as AstNode | null | undefined;
  return name && fn && FUNCTION_TYPES.has(fn.type) ? [name, fn] : null;
}

function readSource(file: string, text: string): Source {
  const program = parse(text, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
    .program as unknown as AstNode;
  const constants = new Map<string, AstNode>();
  const imports = new Map<string, string>();
  visit(program, (node) => {
    const name = node.type === 'VariableDeclarator' ? readName(node.id) : null;
    if (name && node.init) constants.set(name, node.init as AstNode);
    const pattern = node.type === 'VariableDeclarator' && node.init ? (node.id as AstNode) : null;
    for (const property of pattern?.type === 'ObjectPattern' ? (pattern.properties as AstNode[]) : []) {
      const local = property.type === 'ObjectProperty' ? readName(property.value) : null;
      if (local)
        constants.set(local, {
          type: 'Picked',
          loc: property.loc,
          from: node.init,
          key: readName(property.key),
        });
    }
    const local = node.type === 'ImportSpecifier' ? readName(node.local) : null;
    if (local) imports.set(local, readName(node.imported) ?? local);
  });
  return { file, program, constants, imports };
}

function indexSources(sources: Source[]): Index {
  const definitions = new Map<string, Definition[]>();
  const exported = new Map<string, Exported[]>();
  for (const source of sources) {
    for (const statement of source.program.body as AstNode[]) {
      const declaration =
        statement.type === 'ExportNamedDeclaration' ? (statement.declaration as AstNode | null) : null;
      if (declaration?.type !== 'VariableDeclaration') continue;
      for (const declarator of declaration.declarations as AstNode[]) {
        const name = readName(declarator.id);
        if (name && declarator.init)
          exported.set(name, [...(exported.get(name) ?? []), { source, value: declarator.init as AstNode }]);
      }
    }
    visit(source.program, (node) => {
      const found = readFunction(node);
      if (!found?.[0]) return;
      const [name, fn] = found;
      const definition = {
        source,
        params: (fn.params as AstNode[]).map(readParam),
        returns: listReturns(fn),
      };
      definitions.set(name, [...(definitions.get(name) ?? []), definition]);
    });
  }
  return { definitions, exported };
}

function readProperty(object: AstNode, key: string) {
  const property = (object.properties as AstNode[]).find(
    (candidate) => candidate.type === 'ObjectProperty' && readName(candidate.key) === key
  );
  return (property?.value as AstNode | undefined) ?? null;
}

function listValues(object: AstNode) {
  return (object.properties as AstNode[]).flatMap((property) =>
    property.type === 'ObjectProperty' ? [property.value as AstNode] : []
  );
}

function readCalleeName(callee: AstNode) {
  return readName(callee.type === 'MemberExpression' ? callee.property : callee);
}

function resolveName(name: string, context: Context): Exported[] {
  const local = context.source.constants.get(name);
  if (local) return [{ source: context.source, value: local }];
  const imported = context.source.imports.get(name);
  return imported ? (context.exported.get(imported) ?? []) : [];
}

function resolveMember(expression: AstNode, context: Context): Exported[] {
  return resolveName(readName(expression.object) ?? '', context).flatMap(({ source, value }) => {
    const owner = unwrap(value);
    if (owner.type !== 'ObjectExpression') return [];
    if (expression.computed) return listValues(owner).map((item) => ({ source, value: item }));
    const found = readProperty(owner, readName(expression.property) ?? '');
    return found ? [{ source, value: found }] : [];
  });
}

function resolveObjects(node: AstNode, context: Context): Exported[] {
  const expression = unwrap(node);
  if (expression.type === 'ObjectExpression') return [{ source: context.source, value: expression }];
  if (expression.type === 'Identifier')
    return resolveName(expression.name as string, context).flatMap(({ source, value }) =>
      resolveObjects(value, { ...context, source })
    );
  if (expression.type !== 'CallExpression') return [];
  return (context.definitions.get(readCalleeName(expression.callee as AstNode) ?? '') ?? []).flatMap(
    (definition) =>
      definition.returns.flatMap((value) => resolveObjects(value, { ...context, source: definition.source }))
  );
}

function resolvePicked(expression: AstNode, context: Context): Exported[] {
  return resolveObjects(expression.from as AstNode, context).flatMap(({ source, value }) => {
    const found = readProperty(value, expression.key as string);
    return found ? [{ source, value: found }] : [];
  });
}

function resolveFound(found: Exported[], context: Context) {
  return found.flatMap(({ source, value }) => resolveTexts(value, { ...context, source }));
}

function resolveTexts(node: AstNode | null, context: Context): Text[] {
  if (!node || context.seen.has(node)) return [];
  context.seen.add(node);
  const at = { file: context.source.file, line: node.loc?.start.line ?? 0 };
  const expression = unwrap(node);
  const resolve = (next: AstNode | null) => resolveTexts(next, context);
  const unchecked = [{ ...at, length: null }];
  if (NOT_TEXT.has(expression.type)) return [];
  switch (expression.type) {
    case 'StringLiteral':
      return [{ ...at, length: (expression.value as string).length }];
    case 'TemplateLiteral': {
      const parts = expression.quasis as { value: { cooked: string | null; raw: string } }[];
      const fixed = parts.reduce((sum, part) => sum + (part.value.cooked ?? part.value.raw).length, 0);
      const inserted = (expression.expressions as AstNode[]).length * TOAST_PLACEHOLDER_LENGTH;
      return [{ ...at, length: fixed + inserted }];
    }
    case 'ConditionalExpression':
      return [...resolve(expression.consequent as AstNode), ...resolve(expression.alternate as AstNode)];
    case 'LogicalExpression':
      return [...resolve(expression.left as AstNode), ...resolve(expression.right as AstNode)];
    case 'BinaryExpression': {
      if (expression.operator !== '+') return unchecked;
      const longest = (texts: Text[]) =>
        Math.max(TOAST_PLACEHOLDER_LENGTH, ...texts.map((text) => text.length ?? 0));
      return [
        {
          ...at,
          length:
            longest(resolve(expression.left as AstNode)) + longest(resolve(expression.right as AstNode)),
        },
      ];
    }
    case 'Identifier': {
      const found = resolveName(expression.name as string, context);
      if (found.length > 0) return resolveFound(found, context);
      return PASSED_ON.has(expression.name as string) ? [] : unchecked;
    }
    case 'Picked': {
      const found = resolvePicked(expression, context);
      return found.length > 0 ? resolveFound(found, context) : unchecked;
    }
    case 'MemberExpression': {
      const found = resolveMember(expression, context);
      if (found.length > 0) return resolveFound(found, context);
      return !expression.computed && PASSED_ON.has(readName(expression.property) ?? '') ? [] : unchecked;
    }
    case 'ObjectExpression':
      return TOAST_OPTIONS.flatMap((key) => resolve(readProperty(expression, key)));
    case 'CallExpression': {
      const name = readCalleeName(expression.callee as AstNode) ?? '';
      if (TOAST_PASSTHROUGH.has(name)) return [];
      const found = context.definitions.get(name) ?? [];
      if (found.length === 0) return unchecked;
      return found.flatMap((definition) =>
        resolveFound(
          definition.returns.map((value) => ({ source: definition.source, value })),
          context
        )
      );
    }
    default:
      return unchecked;
  }
}

function listCallArguments(node: AstNode, definitions: Map<string, Definition[]>) {
  const callee = node.callee as AstNode;
  const args = node.arguments as AstNode[];
  if (callee.type === 'MemberExpression' && readName(callee.object) === 'toast')
    return TOAST_METHODS.has(readName(callee.property) ?? '') ? args.slice(0, 2) : [];
  const name = readCalleeName(callee) ?? '';
  if (callee.type === 'Identifier' && name === 'toast') return args.slice(0, 2);
  const helper = TOAST_HELPERS.get(name);
  if (helper !== undefined) return args.slice(helper, helper + 1);
  return listDoneArguments(name, args, definitions);
}

function listDoneArguments(name: string, args: AstNode[], definitions: Map<string, Definition[]>) {
  const positions = new Set(
    (definitions.get(name) ?? []).flatMap((definition) =>
      definition.params.flatMap((param, index) => (TOAST_NAMES.has(param) ? [index] : []))
    )
  );
  return [...positions].flatMap((index) => (args[index] ? [args[index]] : []));
}

function listToastArguments(node: AstNode, definitions: Map<string, Definition[]>): Argument[] {
  if (node.type === 'ObjectProperty' && TOAST_NAMES.has(readName(node.key) ?? ''))
    return [{ node: node.value as AstNode, strict: false }];
  if (node.type !== 'CallExpression') return [];
  const name = readCalleeName(node.callee as AstNode) ?? '';
  const direct = listCallArguments(node, definitions);
  const passed = new Set(listDoneArguments(name, node.arguments as AstNode[], definitions));
  return direct.map((argument) => ({ node: argument, strict: !passed.has(argument) }));
}

function describeText(text: Text, strict: boolean) {
  if (text.length === null) return strict ? TOAST_UNCHECKED_MESSAGE : null;
  return text.length > TOAST_LIMIT ? TOAST_MESSAGE : null;
}

export function listToastViolations(
  files: Record<string, string>
): { file: string; line: number; message: string }[] {
  const sources = Object.entries(files).map(([file, text]) => readSource(file, text));
  const index = indexSources(sources);
  const found = new Map<string, { file: string; line: number; message: string }>();
  for (const source of sources) {
    visit(source.program, (node) => {
      for (const argument of listToastArguments(node, index.definitions)) {
        for (const text of resolveTexts(argument.node, { ...index, source, seen: new Set() })) {
          const message = describeText(text, argument.strict);
          if (message) found.set(`${text.file}:${text.line}`, { file: text.file, line: text.line, message });
        }
      }
    });
  }
  return [...found.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}
