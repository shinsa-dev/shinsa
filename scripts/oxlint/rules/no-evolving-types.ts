import type { Rule } from '../types.ts';

const TYPED_FILE = /\.(?:ts|tsx|mts|cts)$/;

export const noEvolvingTypes: Rule = {
  meta: {
    type: 'problem',
    docs: { description: 'A variable declared without a type or a value evolves into any.' },
  },
  create(context) {
    if (!TYPED_FILE.test(context.filename)) return {};
    return {
      VariableDeclaration(node) {
        if (node.kind === 'const' || node.kind === 'using' || node.kind === 'await using') return;
        const parent = node.parent;
        if (parent?.type === 'ForOfStatement' || parent?.type === 'ForInStatement') return;
        for (const declarator of node.declarations) {
          if (declarator.id.type !== 'Identifier' || declarator.id.typeAnnotation) continue;
          const init = declarator.init;
          const empty =
            init === null ||
            (init.type === 'Literal' && init.value === null) ||
            (init.type === 'Identifier' && init.name === 'undefined');
          if (!empty) continue;
          context.report({
            node: declarator,
            message: `\`${declarator.id.name}\` has no type and no value, so TypeScript reads it as any. Give it a type.`,
          });
        }
      },
    };
  },
};
