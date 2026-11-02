import type { Rule } from '../types.ts';

const NEW_ONLY = new Set([
  'ArrayBuffer',
  'BigInt64Array',
  'BigUint64Array',
  'DataView',
  'FinalizationRegistry',
  'Float16Array',
  'Float32Array',
  'Float64Array',
  'Int16Array',
  'Int32Array',
  'Int8Array',
  'Map',
  'Promise',
  'Proxy',
  'Set',
  'SharedArrayBuffer',
  'Uint16Array',
  'Uint32Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'WeakMap',
  'WeakRef',
  'WeakSet',
]);

const CALL_ONLY = new Set(['BigInt', 'Symbol']);

export const noInvalidBuiltinInstantiation: Rule = {
  meta: { type: 'problem', docs: { description: 'Built-ins are made with new exactly when they need it.' } },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || !NEW_ONLY.has(node.callee.name)) return;
        context.report({ node, message: `\`${node.callee.name}\` is made with \`new\`.` });
      },
      NewExpression(node) {
        if (node.callee.type !== 'Identifier' || !CALL_ONLY.has(node.callee.name)) return;
        context.report({ node, message: `\`${node.callee.name}\` is called without \`new\`.` });
      },
    };
  },
};
