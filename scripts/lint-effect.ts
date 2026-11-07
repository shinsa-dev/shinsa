import { parse } from '@babel/parser';
import { type AstNode, listChildren } from './lint-ast.ts';
import { RAW_IO_BASELINE } from './lint-effect-baseline.ts';

export const EFFECT_IMPORT = /from\s+['"](?:effect(?:\/[\w-]+)?|@effect\/[\w-]+)['"]/;

const PROMISE_BRIDGES = new Set(['try', 'tryPromise', 'promise']);

const IO_BRIDGES = new Set(['try', 'tryPromise', 'promise', 'sync', 'callback']);

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

export const SYNC_IO_MESSAGE =
  "File or process I/O outside Effect. Read and write files through FileSystem and Path from effect, run a process through the engine's Shell or the kit's Command, and yield them from an Effect.fn step (a script as one Effect program run once with BunRuntime.runMain); node:path and other pure helpers stay plain (the effect skill → What is Effect code)";

export const EFFECT_SYNC_IO_MESSAGE =
  'File or process I/O outside an effect in Effect code. Read and write through FileSystem from effect, run a process through the Shell or Command service, or call it inside Effect.try (Effect.sync only for a call that cannot fail); a plain helper that does I/O hides it from the type (the effect skill → What is Effect code)';

export const RAW_IO_MESSAGE =
  'Raw node:fs, node:child_process or Bun I/O in Effect code. Read and write through FileSystem and Path from effect and run a process through the Shell or Command service; RAW_IO_BASELINE (scripts/lint-effect-baseline.ts) lists the files still left to move, and the list only shrinks (the effect skill → What is Effect code)';

export const RAW_IO_BASELINE_MESSAGE =
  'This file no longer does raw file or process I/O, or no longer exists. Remove it from RAW_IO_BASELINE in scripts/lint-effect-baseline.ts so it cannot come back';

export const ENGINE_RUNTIME_MESSAGE =
  'A runtime or a Promise class in the engine. Write the module as a Context.Service with its Layer, yield what it needs, and run effects only at the process edge, main.ts; a callback from outside enters with Effect.runForkWith on the context the layer captured (the effect skill → Services and layers)';

const ENGINE_SOURCE = /^apps\/engine\/src\//;

const PROMISE_IO_SOURCE = /^(?:(?:apps|packages)\/[\w-]+\/(?:src|scripts)|scripts)\//;

const SYNC_IO_MODULES = new Set([
  'node:fs',
  'node:fs/promises',
  'node:child_process',
  'fs',
  'fs/promises',
  'child_process',
]);

const BUN_IO = new Set(['spawn', 'spawnSync', 'file', 'write', 'which', 'build']);

export const SYNC_IO_EXEMPT = new Set([
  'apps/engine/src/agents/providers/claude/process/spawn.ts',
  'apps/engine/src/agents/providers/codex/client/spawn.ts',
  'apps/engine/src/agents/transcripts/file.ts',
  'apps/engine/src/eunoe/files.ts',
  'apps/engine/src/git/blobs/spawn.ts',
  'apps/engine/src/store/evidence/image-file.ts',
  'apps/engine/src/terminals/pty/spawn.ts',
]);

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

function isBridgeCall(node: AstNode | undefined, bridges: ReadonlySet<string> = PROMISE_BRIDGES) {
  return node?.type === 'CallExpression' && isMember(node.callee, 'Effect', bridges);
}

function isTryKey(node: AstNode | undefined) {
  return readName(node?.key) === 'try';
}

function isBridgedFunction(chain: AstNode[], index: number, bridges: ReadonlySet<string>) {
  const [parent, grandparent, greatGrandparent] = [chain[index - 1], chain[index - 2], chain[index - 3]];
  const node = chain[index] as AstNode;
  if (parent && isBridgeCall(parent, bridges)) return (parent.arguments as AstNode[]).includes(node);
  if (node.type === 'ObjectMethod') return isTryKey(node) && isBridgeCall(grandparent, bridges);
  return parent?.type === 'ObjectProperty' && isTryKey(parent) && isBridgeCall(greatGrandparent, bridges);
}

function isInsideBridge(chain: AstNode[], bridges: ReadonlySet<string> = PROMISE_BRIDGES) {
  return chain.some((node, index) => isFunction(node) && isBridgedFunction(chain, index, bridges));
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

export function isSyncIoSource(file: string, source: string) {
  return isPromiseIoSource(file, source) && !SYNC_IO_EXEMPT.has(file);
}

function isTypeOnlyImport(node: AstNode) {
  if (node.importKind === 'type') return true;
  const specifiers = node.specifiers as AstNode[];
  return specifiers.length > 0 && specifiers.every((specifier) => specifier.importKind === 'type');
}

function isSyncIoNode(node: AstNode) {
  if (node.type === 'ImportDeclaration') {
    const module = (node.source as AstNode).value as string;
    return SYNC_IO_MODULES.has(module) && !isTypeOnlyImport(node);
  }
  return isMember(node, 'Bun', BUN_IO);
}

export function listSyncIoLines(source: string) {
  const program = parse(source, { sourceType: 'module', plugins: ['typescript'] })
    .program as unknown as AstNode;
  const lines = new Set<number>();
  walk(program, (node) => {
    if (isSyncIoNode(node)) lines.add(node.loc?.start.line ?? 0);
  });
  return [...lines];
}

export function isEffectIoSource(file: string, source: string) {
  const isTest = /\.test\.ts$/.test(file) || /(?:^|\/)test\//.test(file);
  return (
    PROMISE_IO_SOURCE.test(file) &&
    file.endsWith('.ts') &&
    !isTest &&
    EFFECT_IMPORT.test(source) &&
    !SYNC_IO_EXEMPT.has(file)
  );
}

function listIoBindings(program: AstNode) {
  const named = new Set<string>();
  const namespaces = new Set<string>();
  for (const node of program.body as AstNode[]) {
    if (node.type !== 'ImportDeclaration' || isTypeOnlyImport(node)) continue;
    if (!SYNC_IO_MODULES.has((node.source as AstNode).value as string)) continue;
    for (const specifier of node.specifiers as AstNode[]) {
      if (specifier.importKind === 'type') continue;
      const local = readName(specifier.local) ?? '';
      (specifier.type === 'ImportSpecifier' ? named : namespaces).add(local);
    }
  }
  return { named, namespaces };
}

function isIoCall(node: AstNode, bindings: ReturnType<typeof listIoBindings>) {
  if (node.type !== 'CallExpression') return false;
  const callee = node.callee as AstNode;
  if (callee.type === 'Identifier') return bindings.named.has(callee.name as string);
  const object = readName(callee.object);
  return isMember(callee, 'Bun', BUN_IO) || (object !== null && bindings.namespaces.has(object));
}

function isBridgeHelper(node: AstNode) {
  const init = node.init as AstNode | undefined;
  if (node.type !== 'VariableDeclarator' || !init || !isFunction(init)) return false;
  const body = init.body as AstNode;
  const statements = body.type === 'BlockStatement' ? (body.body as AstNode[]) : [];
  const returned = body.type === 'BlockStatement' ? statements[0]?.argument : body;
  const [first] = (init.params as AstNode[]).map(readName);
  const call = returned as AstNode | undefined;
  if (!first || !isBridgeCall(call, IO_BRIDGES)) return false;
  const [argument] = (call?.arguments as AstNode[]) ?? [];
  if (readName(argument) === first) return true;
  const properties = argument?.type === 'ObjectExpression' ? (argument.properties as AstNode[]) : [];
  return properties.some((property) => isTryKey(property) && readName(property.value) === first);
}

function listBridgeHelpers(program: AstNode) {
  const helpers = new Set<string>();
  walk(program, (node) => {
    if (isBridgeHelper(node)) helpers.add(readName(node.id) ?? '');
  });
  return helpers;
}

function isPassedToHelper(chain: AstNode[], helpers: ReadonlySet<string>) {
  return chain.some((node, index) => {
    const parent = chain[index - 1];
    return (
      isFunction(node) &&
      parent?.type === 'CallExpression' &&
      helpers.has(readName(parent.callee) ?? '') &&
      (parent.arguments as AstNode[]).includes(node)
    );
  });
}

export function listRawIoViolations(file: string, source: string) {
  const lines = isEffectIoSource(file, source) ? listSyncIoLines(source) : [];
  if (!RAW_IO_BASELINE.has(file)) return lines.map((line) => ({ line, message: RAW_IO_MESSAGE }));
  return lines.length === 0 ? [{ line: 1, message: RAW_IO_BASELINE_MESSAGE }] : [];
}

export function listStaleBaselineFiles(files: ReadonlySet<string>) {
  return [...RAW_IO_BASELINE].filter((file) => !files.has(file));
}

export function listUnbridgedIoLines(source: string) {
  const program = parse(source, { sourceType: 'module', plugins: ['typescript'] })
    .program as unknown as AstNode;
  const bindings = listIoBindings(program);
  const helpers = listBridgeHelpers(program);
  const lines = new Set<number>();
  walk(program, (node, ancestors) => {
    if (!isIoCall(node, bindings)) return;
    const chain = [...ancestors, node];
    if (isInsideBridge(chain, IO_BRIDGES) || isPassedToHelper(chain, helpers)) return;
    lines.add(node.loc?.start.line ?? 0);
  });
  return [...lines];
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
