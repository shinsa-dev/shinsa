import type { Rule } from '../types.ts';

const COMPLEX_NUMBER = /^0[box]|_/i;

export const useSimpleNumberKeys: Rule = {
  meta: {
    type: 'suggestion',
    docs: { description: 'A number used as an object key is written in base 10.' },
  },
  create(context) {
    return {
      Property(node) {
        if (node.computed || node.key.type !== 'Literal' || typeof node.key.value !== 'number') return;
        if (!COMPLEX_NUMBER.test(node.key.raw ?? '')) return;
        context.report({ node: node.key, message: 'Write this key as a plain base 10 number.' });
      },
    };
  },
};
