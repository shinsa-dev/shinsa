import type { Node } from 'oxc-parser';
import { isFunction } from '../ast.ts';
import type { Rule } from '../types.ts';

const ITERATORS = new Set(['every', 'filter', 'find', 'findIndex', 'flatMap', 'forEach', 'map', 'some']);

function resolveIndexName(callback: Node): string | null {
  const call = callback.parent;
  if (call?.type !== 'CallExpression') return null;
  const params = (callback as Node & { params: Node[] }).params;
  const callee = call.callee;
  if (callee.type !== 'MemberExpression' || callee.computed || callee.property.type !== 'Identifier')
    return null;
  const method = callee.property.name;
  const position = method === 'reduce' || method === 'reduceRight' ? 2 : 1;
  const isIterator = ITERATORS.has(method) || position === 2;
  const isArrayFrom =
    method === 'from' && callee.object.type === 'Identifier' && callee.object.name === 'Array';
  if (!isIterator && !isArrayFrom) return null;
  const index = params[position];
  return index?.type === 'Identifier' ? index.name : null;
}

function isIndexUse(node: Node, names: ReadonlySet<string>): boolean {
  if (node.type === 'Identifier') return names.has(node.name);
  if (node.type === 'TemplateLiteral') return node.expressions.some((part) => isIndexUse(part, names));
  if (node.type === 'BinaryExpression') return isIndexUse(node.left, names) || isIndexUse(node.right, names);
  if (node.type !== 'CallExpression') return false;
  if (node.callee.type === 'Identifier' && node.callee.name === 'String') {
    return node.arguments.some((argument) => isIndexUse(argument, names));
  }
  return node.callee.type === 'MemberExpression' && isIndexUse(node.callee.object, names);
}

function listIndexNames(node: Node): string[] {
  const names: string[] = [];
  for (let current = node.parent; current; current = current.parent) {
    if (!isFunction(current)) continue;
    const name = resolveIndexName(current);
    if (name) names.push(name);
  }
  return names;
}

export const noArrayIndexKey: Rule = {
  meta: { type: 'problem', docs: { description: 'A list key is never the position in the list.' } },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier' || node.name.name !== 'key') return;
        if (node.value?.type !== 'JSXExpressionContainer') return;
        const names = new Set(listIndexNames(node));
        if (names.size === 0) return;
        if (!isIndexUse(node.value.expression, names)) return;
        context.report({
          node,
          message: 'This key is the position in the list. Key it by what the item is.',
        });
      },
    };
  },
};
