import type { Rule } from '../types.ts';

export const noUselessStringRaw: Rule = {
  meta: { type: 'suggestion', docs: { description: 'No String.raw around a string with no backslash.' } },
  create(context) {
    return {
      TaggedTemplateExpression(node) {
        const tag = node.tag;
        if (tag.type !== 'MemberExpression' || tag.computed) return;
        if (tag.object.type !== 'Identifier' || tag.object.name !== 'String') return;
        if (tag.property.type !== 'Identifier' || tag.property.name !== 'raw') return;
        if (node.quasi.quasis.some((quasi) => quasi.value.raw.includes('\\'))) return;
        context.report({
          node,
          message: 'This string has no backslash, so `String.raw` changes nothing. Leave it out.',
        });
      },
    };
  },
};
