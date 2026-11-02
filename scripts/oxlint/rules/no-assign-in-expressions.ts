import type { Node } from 'oxc-parser';
import type { Rule } from '../types.ts';

function isStatementPosition(node: Node): boolean {
  const parent = node.parent;
  if (!parent) return false;
  switch (parent.type) {
    case 'ExpressionStatement':
      return true;
    case 'AssignmentExpression':
      return parent.right === node && isStatementPosition(parent);
    case 'ArrowFunctionExpression':
      return parent.body === node;
    case 'ForStatement':
      return parent.init === node || parent.update === node;
    case 'SequenceExpression':
      return parent.parent?.type === 'ForStatement';
    default:
      return false;
  }
}

export const noAssignInExpressions: Rule = {
  meta: { type: 'problem', docs: { description: 'No assignment inside a larger expression.' } },
  create(context) {
    return {
      AssignmentExpression(node) {
        if (isStatementPosition(node)) return;
        context.report({
          node,
          message: 'An assignment inside an expression is easy to misread. Assign on a line of its own.',
        });
      },
    };
  },
};
