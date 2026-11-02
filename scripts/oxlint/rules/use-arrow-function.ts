import type { Node } from 'oxc-parser';
import { listChildren } from '../ast.ts';
import type { Rule } from '../types.ts';

function usesOwnBinding(node: Node): boolean {
  return listChildren(node).some((child) => {
    if (child.type === 'FunctionDeclaration' || child.type === 'FunctionExpression') return false;
    if (child.type === 'ThisExpression' || child.type === 'Super' || child.type === 'MetaProperty')
      return true;
    if (child.type === 'Identifier' && child.name === 'arguments') return true;
    return usesOwnBinding(child);
  });
}

function isMethod(node: Node) {
  const parent = node.parent;
  if (parent?.type === 'MethodDefinition' || parent?.type === 'TSAbstractMethodDefinition') return true;
  return parent?.type === 'Property' && parent.value === node && (parent.method || parent.kind !== 'init');
}

export const useArrowFunction: Rule = {
  meta: { type: 'suggestion', docs: { description: 'An unnamed function expression is an arrow function.' } },
  create(context) {
    return {
      FunctionExpression(node) {
        if (node.id || node.generator || isMethod(node) || usesOwnBinding(node)) return;
        if (node.params.some((param) => param.type === 'Identifier' && param.name === 'this')) return;
        context.report({
          node,
          message: 'This function uses no `this` of its own. Write it as an arrow function.',
        });
      },
    };
  },
};
