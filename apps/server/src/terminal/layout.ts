import { PLAIN_STYLE, paintTone, type Style, type Tone } from './style.ts';
import { measureWidth, padText, truncateText, wrapText } from './text.ts';

export interface Display {
  style: Style;
  width: number | null;
}

export const PLAIN_DISPLAY: Display = { style: PLAIN_STYLE, width: null };

const GAP = 2;

const MAX_TERM_WIDTH = 30;

const MIN_DESCRIPTION_WIDTH = 32;

const MIN_COLUMN_WIDTH = 12;

interface ListEntry {
  term: string;
  text: string;
}

interface ListOptions {
  indent?: number;
  termWidth?: number;
}

export function resolveTermWidth(terms: string[]) {
  return Math.min(MAX_TERM_WIDTH, Math.max(0, ...terms.map(measureWidth)));
}

export function describeList(display: Display, entries: ListEntry[], options: ListOptions = {}) {
  const indent = ' '.repeat(options.indent ?? 2);
  const termWidth = options.termWidth ?? resolveTermWidth(entries.map((entry) => entry.term));
  const start = indent.length + termWidth + GAP;
  const beside = display.width === null || display.width - start >= MIN_DESCRIPTION_WIDTH;
  return entries.flatMap(({ term, text }) => {
    if (!text) return [`${indent}${term}`];
    if (!beside) {
      const below = `${indent}    `;
      const width = display.width === null ? null : display.width - below.length;
      return [`${indent}${term}`, ...wrapText(display.style, text, width).map((line) => `${below}${line}`)];
    }
    const lines = wrapText(display.style, text, display.width === null ? null : display.width - start);
    const hanging = ' '.repeat(start);
    const rest = lines.slice(1).map((line) => `${hanging}${line}`);
    if (measureWidth(term) > termWidth) return [`${indent}${term}`, `${hanging}${lines[0]}`, ...rest];
    return [`${indent}${padText(term, termWidth + GAP)}${lines[0]}`, ...rest];
  });
}

export function describeParagraph(display: Display, text: string, indent = 0, tone: Tone | null = null) {
  const pad = ' '.repeat(indent);
  const width = display.width === null ? null : display.width - indent;
  return wrapText(display.style, text, width).map(
    (line) => `${pad}${tone ? paintTone(display.style, tone, line) : line}`
  );
}

type Cell = string | { text: string; tone: Tone | null };

interface Table {
  headers?: string[];
  rows: Cell[][];
  fixed?: number[];
  indent?: number;
}

function readCell(cell: Cell | undefined) {
  if (cell === undefined) return { text: '', tone: null };
  return typeof cell === 'string' ? { text: cell, tone: null } : cell;
}

function resolveColumnWidths(display: Display, table: Table, indent: number) {
  const columns = Math.max(table.headers?.length ?? 0, ...table.rows.map((row) => row.length));
  const widths = Array.from({ length: columns }, (_, index) =>
    Math.max(
      [...(table.headers?.[index] ?? '')].length,
      ...table.rows.map((row) => [...readCell(row[index]).text].length)
    )
  );
  if (display.width === null) return widths;
  const fixed = new Set(table.fixed ?? [0]);
  let over = indent + widths.reduce((sum, width) => sum + width, 0) + GAP * (columns - 1) - display.width;
  while (over > 0) {
    const widest = widths.reduce(
      (best, width, index) =>
        !fixed.has(index) && width > MIN_COLUMN_WIDTH && width > (widths[best] ?? 0) ? index : best,
      -1
    );
    if (widest === -1) break;
    widths[widest] = (widths[widest] ?? 0) - 1;
    over -= 1;
  }
  return widths;
}

function paintCell(style: Style, text: string, tone: Tone | null) {
  return tone ? paintTone(style, tone, text) : text;
}

export function describeTable(display: Display, table: Table) {
  const { style } = display;
  const indent = table.indent ?? 0;
  const widths = resolveColumnWidths(display, table, indent);
  const ellipsis = style.symbols?.ellipsis ?? '…';
  const pad = ' '.repeat(indent);
  const describeRow = (cells: Cell[], header: boolean) =>
    `${pad}${widths
      .map((width, index) => {
        const { text, tone } = readCell(cells[index]);
        const cut = truncateText(text, width, ellipsis);
        const painted = paintCell(style, cut, header ? 'dim' : tone);
        return index === widths.length - 1 ? painted : padText(painted, width);
      })
      .join(' '.repeat(GAP))}`.trimEnd();
  return [
    ...(table.headers ? [describeRow(table.headers, true)] : []),
    ...table.rows.map((row) => describeRow(row, false)),
  ];
}

export function describeFields(display: Display, fields: [label: string, value: string][], indent = 2) {
  const width = Math.max(0, ...fields.map(([label]) => measureWidth(label)));
  const pad = ' '.repeat(indent);
  return fields.map(([label, value]) => `${pad}${padText(display.style.dim(label), width + GAP)}${value}`);
}

export function describeHeading(display: Display, title: string, count?: number) {
  const suffix = count === undefined ? '' : `  ${display.style.dim(String(count))}`;
  return `${display.style.bold(title)}${suffix}`;
}

export function describeUsageLines(display: Display, head: string[], args: string[], indent = 2) {
  const { style } = display;
  const pad = ' '.repeat(indent);
  const first = `${pad}${style.accent(head.join(' '))}`;
  if (display.width === null) return [[first, ...args].join(' ')];
  const hanging = ' '.repeat(Math.min(indent + measureWidth(head.join(' ')) + 1, MAX_TERM_WIDTH));
  const lines: string[] = [];
  let line = first;
  for (const arg of args) {
    if (measureWidth(line) + 1 + measureWidth(arg) > display.width) {
      lines.push(line);
      line = `${hanging}${arg}`;
    } else {
      line = `${line} ${arg}`;
    }
  }
  lines.push(line);
  return lines;
}

const USAGE_TOKEN = /\[[^\]]*\]|<[^>]*>|\S+/g;

export function splitUsage(usage: string) {
  const tokens = usage.match(USAGE_TOKEN) ?? [];
  const at = tokens.findIndex((token) => token.startsWith('<') || token.startsWith('['));
  return at === -1 ? { head: tokens, args: [] } : { head: tokens.slice(0, at), args: tokens.slice(at) };
}

export function describeCommandTerm(display: Display, usage: string) {
  const { head, args } = splitUsage(usage);
  return [display.style.accent(head.join(' ')), ...args.map((arg) => display.style.dim(arg))].join(' ');
}
