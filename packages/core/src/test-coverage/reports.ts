import type { CoverageFormat, CoverageHits } from './types.ts';

const LINE_BREAK = /\r?\n/;

const XML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

const GO_BLOCK = /^(.+):(\d+)\.\d+,(\d+)\.\d+ (\d+) (\d+)$/;

function addHits(hits: CoverageHits, path: string, line: number, count: number) {
  if (!(path && Number.isInteger(line) && line > 0 && Number.isFinite(count))) return;
  let lines = hits.get(path);
  if (!lines) {
    lines = new Map();
    hits.set(path, lines);
  }
  lines.set(line, (lines.get(line) ?? 0) + Math.max(0, count));
}

export function parseLcov(text: string): CoverageHits {
  const hits: CoverageHits = new Map();
  let path: string | null = null;
  for (const raw of text.split(LINE_BREAK)) {
    const line = raw.trim();
    if (line.startsWith('SF:')) path = line.slice(3).trim();
    else if (line === 'end_of_record') path = null;
    else if (path && line.startsWith('DA:')) {
      const [number = '', count = ''] = line.slice(3).split(',');
      addHits(hits, path, Number(number), Number(count));
    }
  }
  return hits;
}

function unescapeXml(text: string) {
  return text.replace(/&(amp|lt|gt|quot|apos);/g, (entity) => XML_ENTITIES[entity] ?? entity);
}

function readAttributes(tag: string) {
  const attributes: Record<string, string> = {};
  for (const [, name = '', value = ''] of tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) {
    attributes[name] = unescapeXml(value);
  }
  return attributes;
}

function isAbsolutePath(path: string) {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);
}

function listCoberturaPaths(filename: string, sources: readonly string[]) {
  if (isAbsolutePath(filename) || sources.length === 0) return [filename];
  return sources.map((source) => `${source.replace(/[\\/]+$/, '')}/${filename}`);
}

export function parseCobertura(text: string): CoverageHits {
  const hits: CoverageHits = new Map();
  const sources = [...text.matchAll(/<source>([^<]*)<\/source>/g)]
    .map(([, source = '']) => unescapeXml(source).trim())
    .filter(Boolean);
  for (const [, attributes = '', body = ''] of text.matchAll(/<class\b([^>]*[^/])>([\s\S]*?)<\/class>/g)) {
    const filename = readAttributes(attributes).filename;
    if (!filename) continue;
    const paths = listCoberturaPaths(filename, sources);
    for (const [line] of body.matchAll(/<line\b[^>]*>/g)) {
      const { number, hits: count } = readAttributes(line);
      for (const path of paths) addHits(hits, path, Number(number), Number(count));
    }
  }
  return hits;
}

export function parseGoProfile(text: string): CoverageHits {
  const hits: CoverageHits = new Map();
  for (const raw of text.split(LINE_BREAK)) {
    const match = GO_BLOCK.exec(raw.trim());
    if (!match) continue;
    const [, path = '', start = '', end = '', statements = '', count = ''] = match;
    if (Number(statements) === 0) continue;
    for (let line = Number(start); line <= Number(end); line += 1) addHits(hits, path, line, Number(count));
  }
  return hits;
}

const PARSERS: Record<CoverageFormat, (text: string) => CoverageHits> = {
  lcov: parseLcov,
  cobertura: parseCobertura,
  go: parseGoProfile,
};

export function parseCoverageReport(format: CoverageFormat, text: string) {
  return PARSERS[format](text);
}
