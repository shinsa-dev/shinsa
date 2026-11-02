import type { Node, VisitorObject } from 'oxc-parser';

export interface RuleContext {
  readonly filename: string;
  readonly sourceCode: { readonly text: string; getText(node?: Node): string };
  report(diagnostic: { readonly node: Node; readonly message: string }): void;
}

export interface Rule {
  readonly meta: { readonly type: 'problem' | 'suggestion'; readonly docs: { readonly description: string } };
  create(context: RuleContext): VisitorObject;
}
