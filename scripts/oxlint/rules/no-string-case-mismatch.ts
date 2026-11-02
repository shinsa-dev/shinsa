import type { Node } from 'oxc-parser';
import type { Rule } from '../types.ts';

const CASE_METHODS = new Map<string, (text: string) => string>([
  ['toLowerCase', (text) => text.toLowerCase()],
  ['toUpperCase', (text) => text.toUpperCase()],
]);

function selectCaseMethod(node: Node) {
  if (node.type !== 'CallExpression' || node.arguments.length > 0) return null;
  const callee = node.callee;
  if (callee.type !== 'MemberExpression' || callee.computed || callee.property.type !== 'Identifier')
    return null;
  const method = callee.property.name;
  return CASE_METHODS.has(method) ? method : null;
}

function selectText(node: Node) {
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0)
    return node.quasis[0]?.value.cooked ?? null;
  return null;
}

function isMismatch(method: string, text: string | null) {
  return text !== null && CASE_METHODS.get(method)?.(text) !== text;
}

export const noStringCaseMismatch: Rule = {
  meta: { type: 'problem', docs: { description: 'No comparison a case change can never match.' } },
  create(context) {
    const report = (node: Node, method: string) => {
      context.report({
        node,
        message: `This text can never equal a string after \`${method}()\`. Match its case.`,
      });
    };
    return {
      BinaryExpression(node) {
        if (node.operator !== '===' && node.operator !== '==') return;
        for (const [call, other] of [
          [node.left, node.right],
          [node.right, node.left],
        ] as const) {
          const method = selectCaseMethod(call);
          if (method && isMismatch(method, selectText(other))) report(other, method);
        }
      },
      SwitchStatement(node) {
        const method = selectCaseMethod(node.discriminant);
        if (!method) return;
        for (const option of node.cases) {
          if (option.test && isMismatch(method, selectText(option.test))) report(option.test, method);
        }
      },
    };
  },
};
