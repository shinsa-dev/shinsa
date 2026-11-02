import type { Rule } from '../types.ts';

export const noDynamicNamespaceImportAccess: Rule = {
  meta: {
    type: 'problem',
    docs: { description: 'A namespace import is read by name, never by a computed key.' },
  },
  create(context) {
    const namespaces = new Set<string>();
    return {
      ImportNamespaceSpecifier(node) {
        namespaces.add(node.local.name);
      },
      MemberExpression(node) {
        if (!node.computed || node.object.type !== 'Identifier' || !namespaces.has(node.object.name)) return;
        if (node.property.type === 'Literal') return;
        context.report({
          node,
          message: `\`${node.object.name}\` is read with a computed key, which keeps the bundler from dropping what is unused. Import the names you need.`,
        });
      },
    };
  },
};
