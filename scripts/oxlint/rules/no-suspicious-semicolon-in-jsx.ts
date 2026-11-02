import type { Rule } from '../types.ts';

const STRAY_SEMICOLON = /^;\s*\n/;

export const noSuspiciousSemicolonInJsx: Rule = {
  meta: { type: 'problem', docs: { description: 'No stray semicolon after a JSX element.' } },
  create(context) {
    return {
      JSXText(node) {
        if (!STRAY_SEMICOLON.test(node.value)) return;
        const parent = node.parent;
        if (parent?.type !== 'JSXElement' && parent?.type !== 'JSXFragment') return;
        const index = parent.children.indexOf(node);
        const before = parent.children[index - 1];
        if (before?.type !== 'JSXElement') return;
        context.report({ node, message: 'This semicolon is shown as text. Take it out of the JSX.' });
      },
    };
  },
};
