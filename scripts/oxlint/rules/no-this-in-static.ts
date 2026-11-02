import type { Node } from 'oxc-parser';
import type { Rule } from '../types.ts';

function isStaticMember(node: Node) {
  if (node.type === 'StaticBlock') return true;
  return (node.type === 'MethodDefinition' || node.type === 'PropertyDefinition') && node.static;
}

function isInStatic(node: Node) {
  let current = node.parent;
  while (current) {
    if (current.type === 'FunctionDeclaration') return false;
    if (current.type === 'FunctionExpression' && current.parent?.type !== 'MethodDefinition') return false;
    if (isStaticMember(current)) return true;
    if (current.type === 'ClassBody') return false;
    current = current.parent;
  }
  return false;
}

export const noThisInStatic: Rule = {
  meta: { type: 'suggestion', docs: { description: 'No this or super in a static member.' } },
  create(context) {
    const check = (node: Node, name: string) => {
      if (!isInStatic(node)) return;
      context.report({
        node,
        message: `\`${name}\` in a static member is the class itself. Name the class instead.`,
      });
    };
    return {
      ThisExpression: (node) => check(node, 'this'),
      Super: (node) => check(node, 'super'),
    };
  },
};
