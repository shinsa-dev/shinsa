import type { Node } from 'oxc-parser';
import type { Rule } from '../types.ts';

const LOOPS = new Set([
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
]);

function isLastInLoop(node: Node): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (LOOPS.has(parent.type)) return true;
  if (parent.type === 'BlockStatement') return parent.body.at(-1) === node && isLastInLoop(parent);
  if (parent.type === 'IfStatement') return isLastInLoop(parent);
  return false;
}

export const noUselessContinue: Rule = {
  meta: { type: 'suggestion', docs: { description: 'No continue as the last step of a loop.' } },
  create(context) {
    return {
      ContinueStatement(node) {
        if (node.label || !isLastInLoop(node)) return;
        context.report({ node, message: 'The loop goes on here anyway. Leave out this `continue`.' });
      },
    };
  },
};
