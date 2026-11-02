import { hasDescendant } from '../ast.ts';
import type { Rule } from '../types.ts';

const isAwait = (node: { type: string }) => node.type === 'AwaitExpression';

export const noAwaitInTernary: Rule = {
  meta: { type: 'suggestion', docs: { description: 'Ternaries never wrap awaited calls.' } },
  create(context) {
    return {
      ConditionalExpression(node) {
        const branches = [node.consequent, node.alternate];
        if (!branches.some((branch) => isAwait(branch) || hasDescendant(branch, isAwait, 'nested'))) return;
        context.report({
          node: node.test,
          message:
            'Ternaries never wrap awaited calls. Branch with an if or an early return instead (the conventions skill).',
        });
      },
    };
  },
};
