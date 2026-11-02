import type { Rule } from '../types.ts';

const ROLES_WITH_ELEMENTS = new Set([
  'article',
  'banner',
  'blockquote',
  'button',
  'caption',
  'cell',
  'checkbox',
  'code',
  'columnheader',
  'complementary',
  'contentinfo',
  'deletion',
  'emphasis',
  'figure',
  'form',
  'grid',
  'gridcell',
  'group',
  'heading',
  'insertion',
  'link',
  'list',
  'listitem',
  'main',
  'meter',
  'navigation',
  'paragraph',
  'radio',
  'region',
  'row',
  'rowgroup',
  'rowheader',
  'search',
  'searchbox',
  'separator',
  'strong',
  'subscript',
  'superscript',
  'table',
  'term',
  'textbox',
  'time',
]);

export const useSemanticElements: Rule = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Use the element a role stands for instead of the role.' },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier' || node.name.name !== 'role') return;
        const value = node.value;
        if (
          value?.type !== 'Literal' ||
          typeof value.value !== 'string' ||
          !ROLES_WITH_ELEMENTS.has(value.value)
        )
          return;
        context.report({
          node: node.parent ?? node,
          message: `The \`${value.value}\` role has an element of its own. Use that element instead of the role.`,
        });
      },
    };
  },
};
