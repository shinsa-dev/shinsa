import type { Node } from 'oxc-parser';
import { hasDescendant, isFunction } from '../ast.ts';
import type { Rule } from '../types.ts';

const REDUCERS = new Set(['reduce', 'reduceRight']);

export const noAccumulatingSpread: Rule = {
  meta: { type: 'suggestion', docs: { description: 'A reducer never spreads its accumulator.' } },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.computed || callee.property.type !== 'Identifier')
          return;
        if (!REDUCERS.has(callee.property.name)) return;
        const reducer = node.arguments[0];
        if (!reducer || !isFunction(reducer)) return;
        const accumulator = (reducer as Node & { params: Node[] }).params[0];
        if (accumulator?.type !== 'Identifier') return;
        const spreads = (child: Node) =>
          child.type === 'SpreadElement' &&
          child.argument.type === 'Identifier' &&
          child.argument.name === accumulator.name;
        if (!hasDescendant(reducer, spreads)) return;
        context.report({
          node: reducer,
          message: `Spreading \`${accumulator.name}\` copies it on every step. Push to it or set its keys instead.`,
        });
      },
    };
  },
};
