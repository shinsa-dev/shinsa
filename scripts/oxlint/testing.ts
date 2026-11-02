import { type Node, parseSync, Visitor } from 'oxc-parser';
import { listChildren } from './ast.ts';
import type { Rule } from './types.ts';

export interface Report {
  readonly line: number;
  readonly message: string;
}

function linkParents(node: Node) {
  for (const child of listChildren(node)) {
    (child as { parent?: Node }).parent = node;
    linkParents(child);
  }
}

export function listReports(rule: Rule, code: string, filename = 'sample.tsx'): Report[] {
  const { program } = parseSync(filename, code, { preserveParens: false });
  linkParents(program);
  const reports: Report[] = [];
  const context = {
    filename,
    sourceCode: { text: code, getText: (node?: Node) => (node ? code.slice(node.start, node.end) : code) },
    report: ({ node, message }: { node: Node; message: string }) => {
      reports.push({ line: code.slice(0, node.start).split('\n').length, message });
    },
  };
  new Visitor(rule.create(context)).visit(program);
  return reports;
}
