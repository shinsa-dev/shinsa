import type { BinaryExpression, Node } from 'oxc-parser';
import type { Rule, RuleContext } from '../types.ts';

function listTerms(node: Node): Node[] {
  if (node.type !== 'BinaryExpression' || node.operator !== '+') return [node];
  return [...listTerms(node.left), ...listTerms(node.right)];
}

function isText(node: Node) {
  return (node.type === 'Literal' && typeof node.value === 'string') || node.type === 'TemplateLiteral';
}

function isOneLine(node: BinaryExpression, context: RuleContext) {
  return !context.sourceCode.getText(node).includes('\n');
}

export const useTemplate: Rule = {
  meta: { type: 'suggestion', docs: { description: 'Join text and values with a template literal.' } },
  create(context) {
    return {
      BinaryExpression(node) {
        if (node.operator !== '+') return;
        if (node.parent?.type === 'BinaryExpression' && node.parent.operator === '+') return;
        const terms = listTerms(node);
        if (!terms.some(isText) || terms.every(isText) || !isOneLine(node, context)) return;
        context.report({ node, message: 'Join these with a template literal instead of `+`.' });
      },
    };
  },
};
