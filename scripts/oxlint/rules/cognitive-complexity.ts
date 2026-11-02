import type { Node } from 'oxc-parser';
import { isFunction, listChildren } from '../ast.ts';
import type { Rule } from '../types.ts';

const MAX_COMPLEXITY = 25;

const NESTING = new Set([
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
  'SwitchStatement',
  'CatchClause',
  'ConditionalExpression',
]);

function countLogicalRuns(node: Node, parentOperator: string | null): number {
  if (node.type !== 'LogicalExpression') return 0;
  const own = node.operator === parentOperator ? 0 : 1;
  return own + countLogicalRuns(node.left, node.operator) + countLogicalRuns(node.right, node.operator);
}

function isElseIf(node: Node) {
  return node.parent?.type === 'IfStatement' && node.parent.alternate === node;
}

function countIf(node: Node & { type: 'IfStatement' }, nesting: number): number {
  const own = isElseIf(node) ? 1 : 1 + nesting;
  let score = own + countComplexity(node.test, nesting) + countComplexity(node.consequent, nesting + 1);
  const alternate = node.alternate;
  if (alternate?.type === 'IfStatement') score += countIf(alternate, nesting);
  else if (alternate) score += 1 + countComplexity(alternate, nesting + 1);
  return score;
}

function countComplexity(node: Node, nesting: number): number {
  if (isFunction(node)) return 0;
  if (node.type === 'IfStatement') return countIf(node, nesting);
  if (node.type === 'LogicalExpression' && node.parent?.type !== 'LogicalExpression') {
    const runs = countLogicalRuns(node, null);
    return runs + listChildren(node).reduce((sum, child) => sum + countComplexity(child, nesting), 0);
  }
  const jump = (node.type === 'BreakStatement' || node.type === 'ContinueStatement') && node.label ? 1 : 0;
  const nests = NESTING.has(node.type);
  const own = nests ? 1 + nesting : jump;
  const inner = nests ? nesting + 1 : nesting;
  return own + listChildren(node).reduce((sum, child) => sum + countComplexity(child, inner), 0);
}

function countEnclosingNesting(node: Node) {
  let nesting = 0;
  for (let current = node.parent; current; current = current.parent) {
    if (isFunction(current) || NESTING.has(current.type) || current.type === 'IfStatement') nesting += 1;
  }
  return nesting;
}

export const cognitiveComplexity: Rule = {
  meta: { type: 'suggestion', docs: { description: 'A function stays simple enough to read in one go.' } },
  create(context) {
    const check = (node: Node & { body: Node | null }) => {
      if (!node.body) return;
      const score = countComplexity(node.body, countEnclosingNesting(node));
      if (score <= MAX_COMPLEXITY) return;
      context.report({
        node,
        message: `This function's cognitive complexity is ${score}, past ${MAX_COMPLEXITY}. Split it into smaller steps.`,
      });
    };
    return {
      FunctionDeclaration: check,
      FunctionExpression: check,
      ArrowFunctionExpression: check,
    };
  },
};
