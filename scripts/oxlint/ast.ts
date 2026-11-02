import { type Node, visitorKeys } from 'oxc-parser';

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

export function isFunction(node: Node) {
  return FUNCTION_TYPES.has(node.type);
}

function isNode(value: unknown): value is Node {
  return (
    typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string'
  );
}

export function listChildren(node: Node): Node[] {
  const fields = node as unknown as Record<string, unknown>;
  return (visitorKeys[node.type] ?? []).flatMap((key) => {
    const value = fields[key];
    if (Array.isArray(value)) return value.filter(isNode);
    return isNode(value) ? [value] : [];
  });
}

export function hasDescendant(
  node: Node,
  matches: (child: Node) => boolean,
  scope: 'function' | 'nested' = 'function'
): boolean {
  return listChildren(node).some((child) => {
    if (scope === 'function' && isFunction(child)) return false;
    return matches(child) || hasDescendant(child, matches, scope);
  });
}
