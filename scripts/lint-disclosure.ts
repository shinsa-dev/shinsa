import { parse } from '@babel/parser';

type Node = { type: string; loc?: { start: { line: number } }; [key: string]: unknown };

export const COLLAPSIBLE_PRIMITIVES = new Set([
  'Panel',
  'CompactSection',
  'WideSection',
  'FoldingBlock',
  'TaskGroupSection',
  'ChangeSnippet',
  'ReviewNote',
  'ExpandRow',
  'ToolGroup',
  'UserMessage',
  'TestingPanel',
  'MergeStepsPanel',
  'EvidencePanel',
]);

const FOLD_STATE = /^(open|expanded|folded|collapsed)$/;

export const PERSIST_ID_MESSAGE =
  'A collapsible remembers whether it is open: pass `persistId`, built with createDisclosureId from what it shows (never an index), or `notPersisted(reason)` to opt out (lib/preferences/disclosure.ts, docs/design.md → Where Shinsa differs, 40)';

export const FOLD_STATE_MESSAGE =
  'Fold state in useState is forgotten on refresh. Keep a collapsible’s open state in useDisclosure (lib/preferences/disclosure.ts), or `notPersisted(reason)` to opt out (docs/design.md → Where Shinsa differs, 40)';

export const DISCLOSURE_HEADER_MESSAGE =
  'DisclosureHeader takes a `disclosure` from useDisclosure, never its own open state (docs/design.md → Where Shinsa differs, 40)';

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
  const named = node as { type?: string; name?: string } | null;
  return named?.type === 'JSXIdentifier' || named?.type === 'Identifier' ? (named.name ?? null) : null;
}

function listAttributes(element: Node) {
  return (element.attributes as Node[]).flatMap((attribute) => {
    const name = attribute.type === 'JSXAttribute' ? readName(attribute.name) : null;
    return name ? [name] : [];
  });
}

function isUseState(node: Node) {
  const callee = node.callee as Node;
  if (callee.type === 'MemberExpression') return readName(callee.property) === 'useState';
  return readName(callee) === 'useState';
}

function readFoldState(node: Node) {
  if (node.type !== 'VariableDeclarator') return null;
  const init = node.init as Node | null;
  const id = node.id as Node;
  if (init?.type !== 'CallExpression' || !isUseState(init) || id.type !== 'ArrayPattern') return null;
  const [first] = id.elements as (Node | null)[];
  const name = readName(first);
  return name && FOLD_STATE.test(name) ? name : null;
}

export function listDisclosureViolations(source: string): { line: number; message: string }[] {
  const program = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
    .program as unknown as Node;
  const violations: { line: number; message: string }[] = [];
  const foldStates: number[] = [];
  let folds = false;
  visit(program, (node) => {
    const line = node.loc?.start.line ?? 0;
    if (node.type === 'JSXAttribute' && readName(node.name) === 'aria-expanded') folds = true;
    if (readFoldState(node)) foldStates.push(line);
    if (node.type !== 'JSXOpeningElement') return;
    const name = readName(node.name);
    const attributes = listAttributes(node);
    if (name === 'DisclosureHeader') {
      folds = true;
      if (!attributes.includes('disclosure')) violations.push({ line, message: DISCLOSURE_HEADER_MESSAGE });
    }
    if (name && COLLAPSIBLE_PRIMITIVES.has(name) && !attributes.includes('persistId'))
      violations.push({ line, message: PERSIST_ID_MESSAGE });
  });
  if (folds) for (const line of foldStates) violations.push({ line, message: FOLD_STATE_MESSAGE });
  return violations.sort((a, b) => a.line - b.line);
}
