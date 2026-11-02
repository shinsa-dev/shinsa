import type { Expression, LogicalExpression, Node } from 'oxc-parser';
import type { Rule, RuleContext } from '../types.ts';

type Operator = '&&' | '||';

const EMPTY_VALUES = new Set(['null', 'undefined']);

function unwrap(node: Node): Node {
  return node.type === 'ParenthesizedExpression' ? unwrap(node.expression) : node;
}

function isChain(node: Node) {
  return node.type === 'Identifier' || node.type === 'MemberExpression' || node.type === 'CallExpression';
}

function isEmptyValue(node: Node) {
  return (
    (node.type === 'Literal' && node.value === null) ||
    (node.type === 'Identifier' && EMPTY_VALUES.has(node.name))
  );
}

function resolveComparedSubject(node: Node, operators: ReadonlySet<string>): Node | null {
  if (node.type !== 'BinaryExpression' || !operators.has(node.operator)) return null;
  const left = unwrap(node.left);
  const right = unwrap(node.right);
  if (left.type === 'UnaryExpression' && left.operator === 'typeof' && right.type === 'Literal') {
    const subject = unwrap(left.argument);
    return right.value === 'undefined' && subject.type !== 'Identifier' ? subject : null;
  }
  if (isEmptyValue(right)) return left;
  return isEmptyValue(left) ? right : null;
}

function resolveGuard(node: Node, operator: Operator): Node | null {
  if (operator === '&&') return isChain(node) ? node : resolveComparedSubject(node, new Set(['!=', '!==']));
  if (node.type === 'UnaryExpression' && node.operator === '!') return unwrap(node.argument);
  return resolveComparedSubject(node, new Set(['==', '===']));
}

function resolveAccess(node: Node, operator: Operator): Node | null {
  if (operator === '&&') return isChain(node) ? node : null;
  if (node.type !== 'UnaryExpression' || node.operator !== '!') return null;
  const argument = unwrap(node.argument);
  return isChain(argument) ? argument : null;
}

function extendsSubject(access: Node, subject: string, context: RuleContext): boolean {
  let current = access;
  while (current.type === 'MemberExpression' || current.type === 'CallExpression') {
    current = unwrap(current.type === 'MemberExpression' ? current.object : current.callee);
    if (context.sourceCode.getText(current) === subject) return true;
  }
  return false;
}

function listOperands(node: Expression, operator: Operator): Node[] {
  const inner = unwrap(node);
  if (inner.type !== 'LogicalExpression' || inner.operator !== operator) return [inner];
  return [...listOperands(inner.left, operator), ...listOperands(inner.right, operator)];
}

function isTopOfChain(node: LogicalExpression) {
  const parent = node.parent;
  return !(parent?.type === 'LogicalExpression' && parent.operator === node.operator);
}

export const useOptionalChain: Rule = {
  meta: { type: 'suggestion', docs: { description: 'Use an optional chain instead of guarding each step.' } },
  create(context) {
    const report = (node: Node) =>
      context.report({
        node,
        message: 'Use an optional chain (`?.`) instead of checking each step on its own.',
      });
    return {
      LogicalExpression(node) {
        if (node.operator !== '&&' && node.operator !== '||') return;
        if (!isTopOfChain(node)) return;
        const operator = node.operator;
        const operands = listOperands(node, operator);
        const guarded = operands.some((operand, index) => {
          const next = operands[index + 1];
          const guard = resolveGuard(operand, operator);
          const access = next ? resolveAccess(next, operator) : null;
          return (
            guard !== null &&
            access !== null &&
            extendsSubject(access, context.sourceCode.getText(guard), context)
          );
        });
        if (guarded) report(node);
      },
      MemberExpression(node) {
        const object = unwrap(node.object);
        if (object.type !== 'LogicalExpression' || object.operator !== '||') return;
        const fallback = unwrap(object.right);
        if (fallback.type === 'ObjectExpression' && fallback.properties.length === 0) report(node);
      },
    };
  },
};
