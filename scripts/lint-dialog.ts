import {
  DIALOG_DESCRIPTION_LIMIT,
  DIALOG_DESCRIPTION_MESSAGE,
  TOAST_PLACEHOLDER_LENGTH,
} from './lint-rules.ts';
import {
  type Index,
  indexSources,
  type Node,
  readSource,
  resolveTexts,
  type Source,
  type Text,
  visit,
} from './lint-toast.ts';

type Violation = { file: string; line: number; message: string };

const DESCRIPTION_ELEMENTS = new Set(['DialogDescription', 'AlertDialogDescription']);

const DESCRIPTION_PROPS = new Map([
  ['ConfirmDialog', 'body'],
  ['PercentDialog', 'description'],
]);

function readJsxName(node: unknown) {
  const named = node as { type?: string; name?: unknown } | null;
  return named?.type === 'JSXIdentifier' && typeof named.name === 'string' ? named.name : null;
}

function readElementName(node: Node) {
  return readJsxName((node.openingElement as Node).name);
}

function readAttribute(node: Node, key: string) {
  const attributes = (node.openingElement as Node).attributes as Node[];
  const found = attributes.find(
    (attribute) => attribute.type === 'JSXAttribute' && readJsxName(attribute.name) === key
  );
  const value = found?.value as Node | null | undefined;
  if (!value) return null;
  return value.type === 'JSXExpressionContainer' ? (value.expression as Node) : value;
}

function listPieces(children: Node[]): Node[] {
  return children.flatMap((child) => {
    if (child.type === 'JSXText') return String(child.value).trim() ? [child] : [];
    if (child.type === 'JSXExpressionContainer')
      return (child.expression as Node).type === 'JSXEmptyExpression' ? [] : [child.expression as Node];
    if (child.type === 'JSXElement' || child.type === 'JSXFragment')
      return listPieces(child.children as Node[]);
    return [];
  });
}

function measurePiece(piece: Node, resolve: (node: Node) => Text[]) {
  if (piece.type === 'JSXText') return String(piece.value).replace(/\s+/g, ' ').trim().length;
  const lengths = resolve(piece).flatMap((text) => (text.length === null ? [] : [text.length]));
  return lengths.length === 0 ? null : Math.max(...lengths);
}

function listDescriptionViolations(node: Node, source: Source, index: Index): Violation[] {
  if (node.type !== 'JSXElement') return [];
  const name = readElementName(node) ?? '';
  const prop = DESCRIPTION_PROPS.get(name);
  const pieces = prop
    ? [readAttribute(node, prop)].filter((piece): piece is Node => piece !== null)
    : DESCRIPTION_ELEMENTS.has(name)
      ? listPieces(node.children as Node[])
      : [];
  const resolve = (piece: Node) => resolveTexts(piece, { ...index, source, seen: new Set() });
  const only = pieces.length === 1 ? pieces[0] : null;
  if (only && only.type !== 'JSXText') {
    return resolve(only).flatMap((text) =>
      text.length !== null && text.length > DIALOG_DESCRIPTION_LIMIT
        ? [{ file: text.file, line: text.line, message: DIALOG_DESCRIPTION_MESSAGE }]
        : []
    );
  }
  const lengths = pieces.map((piece) => measurePiece(piece, resolve));
  if (lengths.every((length) => length === null)) return [];
  const total = lengths.reduce<number>((sum, length) => sum + (length ?? TOAST_PLACEHOLDER_LENGTH), 0);
  if (total <= DIALOG_DESCRIPTION_LIMIT) return [];
  return [{ file: source.file, line: node.loc?.start.line ?? 0, message: DIALOG_DESCRIPTION_MESSAGE }];
}

export function listDialogViolations(files: Record<string, string>): Violation[] {
  const sources = Object.entries(files).map(([file, text]) => readSource(file, text));
  const index = indexSources(sources);
  const found = new Map<string, Violation>();
  for (const source of sources) {
    visit(source.program, (node) => {
      for (const violation of listDescriptionViolations(node, source, index))
        found.set(`${violation.file}:${violation.line}`, violation);
    });
  }
  return [...found.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}
