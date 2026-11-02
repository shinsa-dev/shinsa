import type { Node } from 'oxc-parser';
import type { Rule } from '../types.ts';

function isReturnType(annotation: Node) {
  const owner = annotation.parent as (Node & { returnType?: Node | null }) | null;
  return owner?.returnType === annotation;
}

function isThisParameter(annotation: Node) {
  const owner = annotation.parent;
  return owner?.type === 'Identifier' && owner.name === 'this';
}

function isAllowedVoid(node: Node) {
  let current = node.parent;
  while (current?.type === 'TSUnionType') current = current.parent;
  if (!current) return false;
  if (current.type === 'TSTypeParameterInstantiation') return true;
  if (current.type === 'TSTypeParameter') return current.default === node;
  if (current.type !== 'TSTypeAnnotation') return false;
  return isReturnType(current) || isThisParameter(current);
}

export const noConfusingVoidType: Rule = {
  meta: {
    type: 'problem',
    docs: { description: 'void only as a return type or a type argument.' },
  },
  create(context) {
    return {
      TSVoidKeyword(node) {
        if (isAllowedVoid(node)) return;
        context.report({
          node,
          message:
            '`void` here reads as undefined and confuses the reader. Use `undefined`, and keep `void` for return types and type arguments.',
        });
      },
    };
  },
};
