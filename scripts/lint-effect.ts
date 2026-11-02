import { parse } from '@babel/parser';

type Node = { type: string; loc?: { start: { line: number } }; [key: string]: unknown };

export const EFFECT_IMPORT = /from\s+['"](?:effect(?:\/[\w-]+)?|@effect\/[\w-]+)['"]/;

const PROMISE_BRIDGES = new Set(['try', 'tryPromise', 'promise']);

const PROMISE_METHODS = new Set(['then', 'catch', 'finally']);

const TIME_SOURCES = new Set(['Date']);

export const EFFECT_THROW_MESSAGE =
  'A throw in Effect code. Fail with a tagged error instead: `return yield* new NotFound({ … })` (the effect skill → Errors)';

export const EFFECT_TRY_MESSAGE =
  'A try/catch in Effect code. Wrap code that throws in Effect.try or Effect.tryPromise, and handle failures with Effect.catchTag (the effect skill → Errors)';

export const EFFECT_PROMISE_MESSAGE =
  'A promise in Effect code. Call a promise API only inside Effect.tryPromise, and write the rest with Effect.gen or Effect.fn (the effect skill → Writing effects)';

export const EFFECT_GEN_WRAPPER_MESSAGE =
  'A function that only returns Effect.gen. Write it as Effect.fn("name")(function* (…) { … }), which names its span (the effect skill → Writing effects)';

export const EFFECT_FN_PIPE_MESSAGE =
  'A .pipe after Effect.fn. Pass the combinators as more arguments to Effect.fn instead (the effect skill → Writing effects)';

export const EFFECT_DATA_ERROR_MESSAGE =
  'An error from Data. Define every error with Schema.TaggedError, so it is a schema that can cross a boundary (the effect skill → Errors)';

export const EFFECT_CLOCK_MESSAGE =
  'The wall clock in Effect code. Read the time from Clock or DateTime, so a test controls it with TestClock (the effect skill → Time and ids)';

export const EFFECT_JSON_MESSAGE =
  'JSON.parse in Effect code. Decode text with a schema, Schema.fromJsonString(Shape), so the result is checked and a failure is typed (the effect skill → Schemas)';

export const EFFECT_LOGIC_FILE_MESSAGE =
  'A logic file holds one export and nothing beside it. Move its schemas, types and constants to schema.ts, its steps inside the service or handler body, and a step another module needs to a module of its own (the effect skill → File layout)';

export const EFFECT_SCHEMA_FILE_MESSAGE =
  'A schema file holds schemas, types and constants only. Move this function or effect next to the code that runs it (the effect skill → File layout)';

const LOGIC_FILES = /(?:^|\/)(?:handler|service|middleware)\.tsx?$/;

const SCHEMA_FILE = /(?:^|\/)schema\.tsx?$/;

function listChildren(node: Node): Node[] {
  return Object.values(node).flatMap((value) =>
    (Array.isArray(value) ? value : [value]).filter(
      (child): child is Node => Boolean(child) && typeof child === 'object' && 'type' in child
    )
  );
}

function walk(node: Node, visit: (node: Node, ancestors: Node[]) => void, ancestors: Node[] = []) {
  visit(node, ancestors);
  const next = [...ancestors, node];
  for (const child of listChildren(node)) walk(child, visit, next);
}

function readName(node: unknown) {
  const named = node as { type?: string; name?: string } | null;
  return named?.type === 'Identifier' ? (named.name ?? null) : null;
}

function isMember(node: unknown, object: string, properties: ReadonlySet<string>) {
  const member = node as Node | null;
  if (member?.type !== 'MemberExpression') return false;
  const property = readName(member.property);
  return readName(member.object) === object && property !== null && properties.has(property);
}

function isFunction(node: Node) {
  return (
    node.type === 'ArrowFunctionExpression' ||
    node.type === 'FunctionExpression' ||
    node.type === 'FunctionDeclaration' ||
    node.type === 'ObjectMethod' ||
    node.type === 'ClassMethod'
  );
}

function isBridgeCall(node: Node | undefined) {
  return node?.type === 'CallExpression' && isMember(node.callee, 'Effect', PROMISE_BRIDGES);
}

function isTryKey(node: Node | undefined) {
  return readName(node?.key) === 'try';
}

function isBridgedFunction(chain: Node[], index: number) {
  const [parent, grandparent, greatGrandparent] = [chain[index - 1], chain[index - 2], chain[index - 3]];
  const node = chain[index] as Node;
  if (parent && isBridgeCall(parent)) return (parent.arguments as Node[]).includes(node);
  if (node.type === 'ObjectMethod') return isTryKey(node) && isBridgeCall(grandparent);
  return parent?.type === 'ObjectProperty' && isTryKey(parent) && isBridgeCall(greatGrandparent);
}

function isInsideBridge(chain: Node[]) {
  return chain.some((node, index) => isFunction(node) && isBridgedFunction(chain, index));
}

function isPromiseChain(node: Node) {
  if (node.type !== 'CallExpression') return false;
  const callee = node.callee as Node;
  if (callee.type !== 'MemberExpression') return false;
  const method = readName(callee.property);
  const module = readName(callee.object);
  const isModule = module !== null && /^[A-Z]/.test(module);
  return method !== null && PROMISE_METHODS.has(method) && !isModule;
}

function isPromiseNode(node: Node) {
  if (node.type === 'AwaitExpression') return true;
  if (isFunction(node) && node.async === true) return true;
  if (node.type === 'NewExpression' && readName(node.callee) === 'Promise') return true;
  return isPromiseChain(node);
}

function isEffectGen(node: unknown) {
  const call = node as Node | null;
  return call?.type === 'CallExpression' && isMember(call.callee, 'Effect', new Set(['gen']));
}

function returnsOnlyEffectGen(node: Node) {
  if (!isFunction(node) || node.type === 'ClassMethod') return false;
  const body = node.body as Node;
  if (isEffectGen(body)) return true;
  const statements = body.type === 'BlockStatement' ? (body.body as Node[]) : [];
  const [only] = statements;
  return statements.length === 1 && only?.type === 'ReturnStatement' && isEffectGen(only.argument);
}

function isEffectFnCall(node: unknown) {
  const call = node as Node | null;
  if (call?.type !== 'CallExpression') return false;
  const inner = call.callee as Node;
  const builder = inner.type === 'CallExpression' ? inner.callee : inner;
  return isMember(builder, 'Effect', new Set(['fn', 'fnUntraced']));
}

function isPipeAfterFn(node: Node) {
  if (node.type !== 'CallExpression') return false;
  const callee = node.callee as Node;
  return (
    callee.type === 'MemberExpression' &&
    readName(callee.property) === 'pipe' &&
    isEffectFnCall(callee.object)
  );
}

function isDataError(node: Node) {
  return isMember(node, 'Data', new Set(['TaggedError', 'Error']));
}

function isWallClock(node: Node) {
  if (node.type === 'NewExpression') return TIME_SOURCES.has(readName(node.callee) ?? '');
  return node.type === 'CallExpression' && isMember(node.callee, 'Date', new Set(['now']));
}

function isJsonParse(node: Node) {
  return node.type === 'CallExpression' && isMember(node.callee, 'JSON', new Set(['parse']));
}

function listMessages(node: Node, ancestors: Node[]) {
  const bridged = isInsideBridge([...ancestors, node]);
  const checks: [boolean, string][] = [
    [node.type === 'ThrowStatement' && !bridged, EFFECT_THROW_MESSAGE],
    [node.type === 'TryStatement', EFFECT_TRY_MESSAGE],
    [isPromiseNode(node) && !bridged, EFFECT_PROMISE_MESSAGE],
    [returnsOnlyEffectGen(node), EFFECT_GEN_WRAPPER_MESSAGE],
    [isPipeAfterFn(node), EFFECT_FN_PIPE_MESSAGE],
    [isDataError(node), EFFECT_DATA_ERROR_MESSAGE],
    [isWallClock(node), EFFECT_CLOCK_MESSAGE],
    [isJsonParse(node), EFFECT_JSON_MESSAGE],
  ];
  return checks.filter(([broken]) => broken).map(([, message]) => message);
}

export function isEffectSource(file: string, source: string) {
  const isTest = /\.test\.tsx?$/.test(file) || /(?:^|\/)test\//.test(file);
  return !isTest && EFFECT_IMPORT.test(source);
}

function isFunctionValue(node: Node) {
  const declaration = (node.declaration as Node | undefined) ?? node;
  if (declaration.type === 'FunctionDeclaration') return true;
  if (declaration.type !== 'VariableDeclaration') return false;
  return (declaration.declarations as Node[]).some((declarator) => {
    const init = declarator.init as Node | undefined;
    return Boolean(init && (isFunction(init) || isEffectGen(init) || isEffectFnCall(init)));
  });
}

function listLayoutViolations(file: string, program: Node) {
  const statements = (program.body as Node[]).filter((node) => node.type !== 'ImportDeclaration');
  const lineOf = (node: Node) => node.loc?.start.line ?? 0;
  if (LOGIC_FILES.test(file)) {
    const [first, ...rest] = statements;
    const stray = first && first.type !== 'ExportNamedDeclaration' ? [first, ...rest] : rest;
    return stray.map((node) => ({ line: lineOf(node), message: EFFECT_LOGIC_FILE_MESSAGE }));
  }
  if (SCHEMA_FILE.test(file))
    return statements
      .filter(isFunctionValue)
      .map((node) => ({ line: lineOf(node), message: EFFECT_SCHEMA_FILE_MESSAGE }));
  return [];
}

export function listEffectViolations(file: string, source: string) {
  const plugins: ('typescript' | 'jsx')[] = file.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'];
  const program = parse(source, { sourceType: 'module', plugins }).program as unknown as Node;
  const violations: { line: number; message: string }[] = listLayoutViolations(file, program);
  walk(program, (node, ancestors) => {
    const line = node.loc?.start.line ?? 0;
    for (const message of listMessages(node, ancestors)) violations.push({ line, message });
  });
  return violations;
}
