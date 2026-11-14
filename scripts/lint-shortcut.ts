import type { AstNode } from './lint-ast.ts';

export const SHORTCUT_FILES = [
  'apps/web/src/hooks/use-command-key.ts',
  'apps/web/src/hooks/use-app-shortcuts.ts',
  'apps/web/src/hooks/use-code-keys.ts',
  'apps/web/src/hooks/use-review-keys.ts',
  'apps/web/src/hooks/use-terminal-keys.ts',
];

const KEY_EVENTS = new Set(['keydown', 'keyup']);

function isGlobalKeyListener(node: AstNode) {
  if (node.type !== 'CallExpression') return false;
  const callee = node.callee as AstNode & { name?: string; property?: AstNode & { name?: string } };
  const name = callee.type === 'MemberExpression' ? callee.property?.name : callee.name;
  if (name !== 'addEventListener') return false;
  const [event] = node.arguments as (AstNode & { value?: unknown })[];
  return event?.type === 'StringLiteral' && KEY_EVENTS.has(String(event.value));
}

export function isStrayKeyListener(file: string, node: AstNode) {
  return !SHORTCUT_FILES.includes(file) && isGlobalKeyListener(node);
}
