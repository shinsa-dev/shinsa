import type { Node } from 'oxc-parser';
import { isFunction, listChildren } from '../ast.ts';
import type { Rule } from '../types.ts';

function listPatternNames(pattern: Node): Node[] {
  if (pattern.type === 'Identifier') return [pattern];
  if (pattern.type === 'AssignmentPattern') return listPatternNames(pattern.left);
  if (pattern.type === 'RestElement') return listPatternNames(pattern.argument);
  if (pattern.type === 'ArrayPattern')
    return pattern.elements.flatMap((element) => (element ? listPatternNames(element) : []));
  if (pattern.type === 'ObjectPattern') {
    return pattern.properties.flatMap((property) =>
      listPatternNames(property.type === 'Property' ? property.value : property)
    );
  }
  return [];
}

function isScopeLevel(node: Node, scope: Node) {
  const parent = node.parent?.type.startsWith('Export') ? node.parent.parent : node.parent;
  return parent === scope || (parent?.type === 'BlockStatement' && parent.parent === scope);
}

function listDeclaredNames(node: Node, scope: Node): Node[] {
  return listChildren(node).flatMap((child) => {
    if (child.type === 'FunctionDeclaration') {
      return child.body && child.id && isScopeLevel(child, scope) ? [child.id] : [];
    }
    if (isFunction(child)) return [];
    if (child.type === 'VariableDeclaration' && child.kind === 'var') {
      return [
        ...child.declarations.flatMap((declarator) => listPatternNames(declarator.id)),
        ...listDeclaredNames(child, scope),
      ];
    }
    return listDeclaredNames(child, scope);
  });
}

export const noRedeclare: Rule = {
  meta: { type: 'problem', docs: { description: 'No var or function declared twice in one scope.' } },
  create(context) {
    const check = (scope: Node, params: Node[]) => {
      const seen = new Set<string>();
      for (const name of [...params.flatMap(listPatternNames), ...listDeclaredNames(scope, scope)]) {
        if (name.type !== 'Identifier' || name.name === 'this') continue;
        if (seen.has(name.name)) {
          context.report({
            node: name,
            message: `\`${name.name}\` is already declared here. Give it a name of its own.`,
          });
        }
        seen.add(name.name);
      }
    };
    const checkFunction = (node: Node) => {
      if (isFunction(node) && node.body) check(node.body, node.params);
    };
    return {
      Program: (node) => check(node, []),
      FunctionDeclaration: checkFunction,
      FunctionExpression: checkFunction,
      ArrowFunctionExpression: checkFunction,
    };
  },
};
