export type AstNode = { type: string; loc?: { start: { line: number } }; [key: string]: unknown };

export function listChildren(node: AstNode): AstNode[] {
  return Object.values(node).flatMap((value) =>
    (Array.isArray(value) ? value : [value]).filter(
      (child): child is AstNode => Boolean(child) && typeof child === 'object' && 'type' in child
    )
  );
}

export function visit(node: AstNode, onNode: (node: AstNode) => void) {
  onNode(node);
  for (const child of listChildren(node)) visit(child, onNode);
}
