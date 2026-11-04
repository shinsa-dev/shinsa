import { parse } from '@babel/parser';
import { type AstNode, listChildren } from './lint-ast.ts';

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
  'A Data.Error. Define every error with Schema.TaggedError, so it is a schema that can cross a boundary (the effect skill → Errors)';

export const EFFECT_CLOCK_MESSAGE =
  'The wall clock in Effect code. Read the time from Clock or DateTime, so a test controls it with TestClock (the effect skill → Time and ids)';

export const EFFECT_JSON_MESSAGE =
  'JSON.parse in Effect code. Decode text with a schema, Schema.fromJsonString(Shape), so the result is checked and a failure is typed (the effect skill → Schemas)';

export const EFFECT_LOGIC_FILE_MESSAGE =
  'A logic file holds one export and nothing beside it. Move its schemas, types and constants to schema.ts, its steps inside the service or handler body, and a step another module needs to a module of its own (the effect skill → File layout)';

export const EFFECT_SCHEMA_FILE_MESSAGE =
  'A schema file holds schemas, types and constants only. Move this function or effect next to the code that runs it (the effect skill → File layout)';

export const PROMISE_IO_MESSAGE =
  'Promise I/O outside Effect. Write the module as a Context.Service provided by a Layer (a script as one Effect program run once with BunRuntime.runMain), with Effect.fn and Effect.tryPromise around the promise API; only React components (.tsx) keep plain promises, and reach I/O through the app runtime (the effect skill → Services and layers)';

export const ENGINE_RUNTIME_MESSAGE =
  'A runtime or a Promise class in the engine. Write the module as a Context.Service with its Layer, yield what it needs, and run effects only at the process edge, main.ts; a callback from outside enters with Effect.runForkWith on the context the layer captured (the effect skill → Services and layers)';

const ENGINE_SOURCE = /^apps\/engine\/src\//;

const PROMISE_IO_SOURCE = /^(?:apps\/[\w-]+\/src|packages\/[\w-]+\/src|scripts)\//;

const ENGINE_EDGE = 'apps/engine/src/main.ts';

const RUN_METHODS = new Set([
  'runPromise',
  'runPromiseExit',
  'runSync',
  'runSyncExit',
  'runFork',
  'runCallback',
]);

const SERVICE_BASES = /^(?:Context\.Service|Context\.Reference|Schema\.\w+|Error|TypeError|RangeError)$/;

const LOGIC_FILES = /(?:^|\/)(?:handler|service|middleware)\.tsx?$/;

const SCHEMA_FILE = /(?:^|\/)schema\.tsx?$/;

const SCHEMA_PARSER =
  /^(?:(?:decode|encode)(?:Unknown)?(?:Sync|Option|Effect|Exit|Promise|Result)?|is|asserts)$/;

function walk(
  node: AstNode,
  visit: (node: AstNode, ancestors: AstNode[]) => void,
  ancestors: AstNode[] = []
) {
  visit(node, ancestors);
  const next = [...ancestors, node];
  for (const child of listChildren(node)) walk(child, visit, next);
}

function readName(node: unknown) {
  const named = node as { type?: string; name?: string } | null;
  return named?.type === 'Identifier' ? (named.name ?? null) : null;
}

function isMember(node: unknown, object: string, properties: ReadonlySet<string>) {
  const member = node as AstNode | null;
  if (member?.type !== 'MemberExpression') return false;
  const property = readName(member.property);
  return readName(member.object) === object && property !== null && properties.has(property);
}

function isFunction(node: AstNode) {
  return (
    node.type === 'ArrowFunctionExpression' ||
    node.type === 'FunctionExpression' ||
    node.type === 'FunctionDeclaration' ||
    node.type === 'ObjectMethod' ||
    node.type === 'ClassMethod'
  );
}

function isBridgeCall(node: AstNode | undefined) {
  return node?.type === 'CallExpression' && isMember(node.callee, 'Effect', PROMISE_BRIDGES);
}

function isTryKey(node: AstNode | undefined) {
  return readName(node?.key) === 'try';
}

function isBridgedFunction(chain: AstNode[], index: number) {
  const [parent, grandparent, greatGrandparent] = [chain[index - 1], chain[index - 2], chain[index - 3]];
  const node = chain[index] as AstNode;
  if (parent && isBridgeCall(parent)) return (parent.arguments as AstNode[]).includes(node);
  if (node.type === 'ObjectMethod') return isTryKey(node) && isBridgeCall(grandparent);
  return parent?.type === 'ObjectProperty' && isTryKey(parent) && isBridgeCall(greatGrandparent);
}

function isInsideBridge(chain: AstNode[]) {
  return chain.some((node, index) => isFunction(node) && isBridgedFunction(chain, index));
}

function isPromiseChain(node: AstNode) {
  if (node.type !== 'CallExpression') return false;
  const callee = node.callee as AstNode;
  if (callee.type !== 'MemberExpression') return false;
  const method = readName(callee.property);
  const module = readName(callee.object);
  const isModule = module !== null && /^[A-Z]/.test(module);
  return method !== null && PROMISE_METHODS.has(method) && !isModule;
}

function isPromiseNode(node: AstNode) {
  if (node.type === 'AwaitExpression') return true;
  if (isFunction(node) && node.async === true) return true;
  if (node.type === 'NewExpression' && readName(node.callee) === 'Promise') return true;
  return isPromiseChain(node);
}

function isEffectGen(node: unknown) {
  const call = node as AstNode | null;
  return call?.type === 'CallExpression' && isMember(call.callee, 'Effect', new Set(['gen']));
}

function returnsOnlyEffectGen(node: AstNode) {
  if (!isFunction(node) || node.type === 'ClassMethod') return false;
  const body = node.body as AstNode;
  if (isEffectGen(body)) return true;
  const statements = body.type === 'BlockStatement' ? (body.body as AstNode[]) : [];
  const [only] = statements;
  return statements.length === 1 && only?.type === 'ReturnStatement' && isEffectGen(only.argument);
}

function isSchemaParser(node: unknown) {
  const call = node as AstNode | null;
  if (call?.type !== 'CallExpression') return false;
  const callee = call.callee as AstNode;
  if (callee.type !== 'MemberExpression' || readName(callee.object) !== 'Schema') return false;
  return SCHEMA_PARSER.test(readName(callee.property) ?? '');
}

function isEffectFnCall(node: unknown) {
  const call = node as AstNode | null;
  if (call?.type !== 'CallExpression') return false;
  const inner = call.callee as AstNode;
  const builder = inner.type === 'CallExpression' ? inner.callee : inner;
  return isMember(builder, 'Effect', new Set(['fn', 'fnUntraced']));
}

function isPipeAfterFn(node: AstNode) {
  if (node.type !== 'CallExpression') return false;
  const callee = node.callee as AstNode;
  return (
    callee.type === 'MemberExpression' &&
    readName(callee.property) === 'pipe' &&
    isEffectFnCall(callee.object)
  );
}

function isDataError(node: AstNode) {
  return isMember(node, 'Data', new Set(['Error']));
}

function isWallClock(node: AstNode) {
  if (node.type === 'NewExpression') return TIME_SOURCES.has(readName(node.callee) ?? '');
  return node.type === 'CallExpression' && isMember(node.callee, 'Date', new Set(['now']));
}

function isJsonParse(node: AstNode) {
  return node.type === 'CallExpression' && isMember(node.callee, 'JSON', new Set(['parse']));
}

function listMessages(node: AstNode, ancestors: AstNode[]) {
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

export function isPromiseIoSource(file: string, source: string) {
  const isTest = /\.test\.ts$/.test(file) || /(?:^|\/)test\//.test(file);
  return PROMISE_IO_SOURCE.test(file) && file.endsWith('.ts') && !isTest && !EFFECT_IMPORT.test(source);
}

export function isEngineRuntimeSource(file: string) {
  return ENGINE_SOURCE.test(file) && file !== ENGINE_EDGE && !/\.test\.tsx?$/.test(file);
}

function readCalleeBase(node: unknown): string | null {
  const current = node as AstNode | null;
  if (!current) return null;
  if (current.type === 'Identifier') return current.name as string;
  if (current.type === 'CallExpression') return readCalleeBase(current.callee);
  if (current.type === 'MemberExpression') {
    const object = readCalleeBase(current.object);
    const property = readName(current.property);
    return object && property ? `${object}.${property}` : null;
  }
  return null;
}

function isRuntimeNode(node: AstNode) {
  if (node.type === 'Identifier' && (node.name === 'ManagedRuntime' || node.name === 'edgeRuntime'))
    return true;
  if (node.type === 'CallExpression') {
    const callee = node.callee as AstNode;
    if (callee.type !== 'MemberExpression') return false;
    const property = readName(callee.property);
    return property !== null && RUN_METHODS.has(property);
  }
  if (node.type !== 'ExportNamedDeclaration') return false;
  const declaration = node.declaration as AstNode | undefined;
  if (declaration?.type !== 'ClassDeclaration') return false;
  const base = readCalleeBase(declaration.superClass);
  return base === null || !SERVICE_BASES.test(base);
}

export function listEngineRuntimeLines(file: string, source: string) {
  const plugins: ('typescript' | 'jsx')[] = file.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'];
  const program = parse(source, { sourceType: 'module', plugins }).program as unknown as AstNode;
  const lines = new Set<number>();
  walk(program, (node) => {
    if (isRuntimeNode(node)) lines.add(node.loc?.start.line ?? 0);
  });
  return [...lines];
}

export function listPromiseLines(file: string, source: string) {
  const plugins: ('typescript' | 'jsx')[] = file.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'];
  const program = parse(source, { sourceType: 'module', plugins }).program as unknown as AstNode;
  const lines: number[] = [];
  walk(program, (node) => {
    if (isPromiseNode(node)) lines.push(node.loc?.start.line ?? 0);
  });
  return lines;
}

function isFunctionValue(node: AstNode) {
  const declaration = (node.declaration as AstNode | undefined) ?? node;
  if (declaration.type === 'FunctionDeclaration') return true;
  if (declaration.type !== 'VariableDeclaration') return false;
  return (declaration.declarations as AstNode[]).some((declarator) => {
    const init = declarator.init as AstNode | undefined;
    return Boolean(
      init && (isFunction(init) || isEffectGen(init) || isEffectFnCall(init) || isSchemaParser(init))
    );
  });
}

function listLayoutViolations(file: string, program: AstNode) {
  const statements = (program.body as AstNode[]).filter((node) => node.type !== 'ImportDeclaration');
  const lineOf = (node: AstNode) => node.loc?.start.line ?? 0;
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
  const program = parse(source, { sourceType: 'module', plugins }).program as unknown as AstNode;
  const violations: { line: number; message: string }[] = listLayoutViolations(file, program);
  walk(program, (node, ancestors) => {
    const line = node.loc?.start.line ?? 0;
    for (const message of listMessages(node, ancestors)) violations.push({ line, message });
  });
  return violations;
}
