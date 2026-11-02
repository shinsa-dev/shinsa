import type { Node } from 'oxc-parser';
import type { Rule } from '../types.ts';

const JUMPS = new Set(['ReturnStatement', 'ThrowStatement', 'BreakStatement', 'ContinueStatement']);

function isJump(node: Node): boolean {
  if (JUMPS.has(node.type)) return true;
  if (node.type !== 'BlockStatement') return false;
  const last = node.body.at(-1);
  return last !== undefined && JUMPS.has(last.type);
}

export const noUselessElse: Rule = {
  meta: {
    type: 'suggestion',
    docs: { description: 'No else after a branch that returns, throws, breaks or continues.' },
  },
  create(context) {
    return {
      IfStatement(node) {
        if (!node.alternate || !isJump(node.consequent)) return;
        context.report({
          node: node.alternate,
          message:
            'This else is not needed: the branch before it always leaves. Take its body out of the else.',
        });
      },
    };
  },
};
