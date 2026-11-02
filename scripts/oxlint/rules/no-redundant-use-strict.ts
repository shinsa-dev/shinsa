import type { Rule } from '../types.ts';

export const noRedundantUseStrict: Rule = {
  meta: {
    type: 'suggestion',
    docs: { description: 'No "use strict" in a module, which is strict already.' },
  },
  create(context) {
    return {
      ExpressionStatement(node) {
        if (node.directive !== 'use strict') return;
        context.report({ node, message: 'Modules are strict already. Leave out "use strict".' });
      },
    };
  },
};
