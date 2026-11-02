import type { Node } from 'oxc-parser';
import { isFunction } from '../ast.ts';
import type { Rule } from '../types.ts';

export const noForEach: Rule = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Loop with for…of, unless the callback needs the index.' },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.computed || callee.property.type !== 'Identifier')
          return;
        if (callee.property.name !== 'forEach') return;
        const callback = node.arguments[0];
        if (!callback || !isFunction(callback)) return;
        if ((callback as Node & { params: Node[] }).params.length > 1) return;
        context.report({ node: callee.property, message: 'Loop with `for…of` instead of `forEach`.' });
      },
    };
  },
};
