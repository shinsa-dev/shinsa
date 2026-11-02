import type { Rule } from '../types.ts';

export const noUselessUndefinedInitialization: Rule = {
  meta: {
    type: 'suggestion',
    docs: { description: 'A variable is undefined without being set to undefined.' },
  },
  create(context) {
    return {
      VariableDeclarator(node) {
        if (node.init?.type !== 'Identifier' || node.init.name !== 'undefined') return;
        if (node.parent?.type === 'VariableDeclaration' && node.parent.kind === 'const') return;
        context.report({
          node: node.init,
          message: 'A variable starts as undefined. Leave out `= undefined`.',
        });
      },
    };
  },
};
