import type { Node } from 'oxc-parser';
import { isFunction } from '../ast.ts';
import type { Rule } from '../types.ts';

function selectEnclosingFunction(node: Node) {
  let current = node.parent;
  while (current && !isFunction(current)) current = current.parent;
  return current;
}

export const noVoidTypeReturn: Rule = {
  meta: { type: 'problem', docs: { description: 'No value returned from a function typed void.' } },
  create(context) {
    return {
      ReturnStatement(node) {
        if (!node.argument) return;
        const owner = selectEnclosingFunction(node);
        if (!owner || !isFunction(owner) || owner.returnType?.typeAnnotation.type !== 'TSVoidKeyword') return;
        context.report({
          node: node.argument,
          message: 'A function typed `void` returns nothing. Leave out the value.',
        });
      },
    };
  },
};
