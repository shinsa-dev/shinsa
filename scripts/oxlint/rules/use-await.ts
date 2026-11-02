import type { Node } from 'oxc-parser';
import { hasDescendant } from '../ast.ts';
import type { Rule } from '../types.ts';

const isAsyncStep = (node: Node) =>
  node.type === 'AwaitExpression' || (node.type === 'ForOfStatement' && node.await);

export const useAwait: Rule = {
  meta: { type: 'suggestion', docs: { description: 'An async function awaits something.' } },
  create(context) {
    const check = (node: Node & { async: boolean; body: Node | null }) => {
      if (!node.async || !node.body || node.body.type !== 'BlockStatement') return;
      if (hasDescendant(node.body, isAsyncStep)) return;
      context.report({
        node,
        message: 'This async function awaits nothing. Remove `async`, or await what it waits for.',
      });
    };
    return {
      FunctionDeclaration: check,
      FunctionExpression: check,
      ArrowFunctionExpression: check,
    };
  },
};
