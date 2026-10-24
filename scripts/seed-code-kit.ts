import { deflateSync } from 'node:zlib';
import type { ChatEditHunk } from '../packages/core/src/index.ts';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

export type Rgb = readonly [number, number, number];

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  color: Rgb;
}

export function resolveCrc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function serializeChunk(type: string, data: Uint8Array) {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(new TextEncoder().encode(type), 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, resolveCrc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

export function serializePng(width: number, height: number, paint: (x: number, y: number) => Rgb) {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const offset = y * (1 + width * 3);
    for (let x = 0; x < width; x += 1) rows.set(paint(x, y), offset + 1 + x * 3);
  }
  const chunks = [
    Uint8Array.from(PNG_SIGNATURE),
    serializeChunk('IHDR', header),
    serializeChunk('IDAT', deflateSync(rows)),
    serializeChunk('IEND', new Uint8Array()),
  ];
  const png = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    png.set(chunk, at);
    at += chunk.length;
  }
  return png;
}

export function serializeRectsPng(width: number, height: number, background: Rgb, rects: Rect[]) {
  return serializePng(width, height, (x, y) => {
    for (let index = rects.length - 1; index >= 0; index -= 1) {
      const rect = rects[index];
      if (!rect) continue;
      if (x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height)
        return rect.color;
    }
    return background;
  });
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function replaceRequired(content: string, from: string, to: string, label: string) {
  const pattern = /^[\w$]+$/.test(from)
    ? new RegExp(`(?<![\\w$])${escapeRegExp(from)}(?![\\w$])`, 'g')
    : new RegExp(escapeRegExp(from), 'g');
  if (!pattern.test(content))
    throw new Error(`${label}: “${from}” is not in the file; update scripts/seed-code.ts.`);
  return content.replace(pattern, to);
}

export function replaceAllRequired(
  content: string,
  pairs: readonly (readonly [string, string])[],
  label: string
) {
  return pairs.reduce((text, [from, to]) => replaceRequired(text, from, to, label), content);
}

export function resolveLine(content: string, needle: string, after = 0) {
  const index = content.split('\n').findIndex((line, at) => at >= after && line.includes(needle));
  if (index < 0) throw new Error(`“${needle}” is not in the seeded file; update scripts/seed-code.ts.`);
  return index + 1;
}

export function resolveImportsEnd(content: string) {
  const lines = content.split('\n');
  let end = 0;
  let inside = false;
  for (const [index, line] of lines.entries()) {
    if (line.startsWith('import ')) inside = true;
    if (inside && /(from\s+)?['"][^'"]+['"];?\s*$/.test(line)) {
      inside = false;
      end = index + 1;
    }
  }
  return end;
}

export function insertAfterImports(content: string, block: string) {
  const lines = content.split('\n');
  const end = resolveImportsEnd(content);
  return [...lines.slice(0, end), ...block.split('\n'), ...lines.slice(end)].join('\n');
}

export function insertBeforeLastHeading(markdown: string, block: string) {
  const lines = markdown.split('\n');
  const index = lines.reduce((last, line, at) => (line.startsWith('## ') ? at : last), -1);
  if (index < 0) throw new Error('The document has no second-level heading; update scripts/seed-code.ts.');
  return [...lines.slice(0, index), ...block.split('\n'), ...lines.slice(index)].join('\n');
}

export interface LockfileBump {
  content: string;
  name: string;
  from: string;
  to: string;
  line: number;
}

export function bumpLockfileEntry(lockfile: string): LockfileBump {
  const lines = lockfile.split('\n');
  const start = lines.findIndex((line) => line.trim() === '"packages": {');
  const entry = /^(\s+)"([^"]+)": \["\2@(\d+)\.(\d+)\.(\d+)", (.*), "sha512-[^"]+"\],$/;
  const index = lines.findIndex((line, at) => {
    const found = at > start && start >= 0 ? entry.exec(line) : null;
    if (!found) return false;
    const version = `${found[3]}.${found[4]}.${found[5]}`;
    return !found[6]?.includes(version) && !lockfile.includes(`"${found[2]}": "${version}"`);
  });
  const match = entry.exec(lines[index] ?? '');
  if (!match) throw new Error('bun.lock has no package entry to bump; update scripts/seed-code.ts.');
  const [, indent, name, major, minor, patch, rest] = match;
  const from = `${major}.${minor}.${patch}`;
  const to = `${major}.${minor}.${Number(patch) + 1}`;
  const integrity = new Bun.CryptoHasher('sha512').update(`${name}@${to}`).digest('base64');
  lines[index] = `${indent}"${name}": ["${name}@${to}", ${rest}, "sha512-${integrity}"],`;
  return { content: lines.join('\n'), name: name ?? '', from, to, line: index + 1 };
}

export function listEditHunks(before: string, after: string): ChatEditHunk[] {
  const old = before.split('\n');
  const next = after.split('\n');
  if (old.length === next.length) {
    const hunks: ChatEditHunk[] = [];
    let index = 0;
    while (index < old.length) {
      if (old[index] === next[index]) {
        index += 1;
        continue;
      }
      const from = index;
      while (index < old.length && old[index] !== next[index]) index += 1;
      hunks.push({ before: old.slice(from, index).join('\n'), after: next.slice(from, index).join('\n') });
    }
    return hunks;
  }
  let prefix = 0;
  while (prefix < old.length && old[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < old.length - prefix &&
    suffix < next.length - prefix &&
    old.at(-1 - suffix) === next.at(-1 - suffix)
  ) {
    suffix += 1;
  }
  const anchor = Math.max(0, prefix - 1);
  return [
    {
      before: old.slice(anchor, old.length - suffix).join('\n'),
      after: next.slice(anchor, next.length - suffix).join('\n'),
    },
  ];
}

export interface ImportFile {
  path: string;
  mode: string;
  content: Uint8Array;
}

export interface ImportCommit {
  message: string;
  at: number;
  files: ImportFile[];
}

export function serializeFastImport(ref: string, author: string, commits: readonly ImportCommit[]) {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const text = (value: string) => parts.push(encoder.encode(value));
  const data = (bytes: Uint8Array) => {
    text(`data ${bytes.length}\n`);
    parts.push(bytes);
    text('\n');
  };
  for (const commit of commits) {
    const stamp = `${author} ${Math.floor(commit.at / 1000)} +0000`;
    text(`commit ${ref}\nauthor ${stamp}\ncommitter ${stamp}\n`);
    data(encoder.encode(commit.message));
    for (const file of commit.files) {
      text(`M ${file.mode} inline ${file.path}\n`);
      data(file.content);
    }
  }
  return Buffer.concat(parts);
}

export function countLines(content: string) {
  return content.endsWith('\n') ? content.split('\n').length - 1 : content.split('\n').length;
}

export function serializeNumberedLines(content: string, start: number, end: number) {
  return content
    .split('\n')
    .slice(start - 1, end)
    .map((line, index) => `${start + index}\t${line}`)
    .join('\n');
}

export function createRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const FIXTURE_FILES = [
  'apps/web/src/components/code/review.tsx',
  'apps/web/src/components/code/changes.tsx',
  'apps/web/src/lib/code/diff.ts',
  'packages/core/src/decide/lifecycle.ts',
  'packages/core/src/report/assemble.ts',
  'apps/server/src/git/diff.ts',
];

const FIXTURE_WHY = [
  'The early return skips the empty report, so the walkthrough never shows a blank section.',
  'Ranks by attention first and keeps the agent order inside each rank.',
  'The range ends on the closing brace, so the spotlight covers the whole block.',
  'Reads the worktree, so the lines move if the agent edits the file again.',
  'A renamed file keeps its old path in the key, which the draft relies on.',
];

const FIXTURE_ATTENTION = ['critical', 'high', 'normal', 'normal', 'normal'] as const;

export const FIXTURE_SPOTS_PER_SECTION = 10;

export function serializeReviewFixture(word: 'target' | 'spot', sections: number) {
  const random = createRandom(42);
  const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)] as T;
  const name = word.toUpperCase();
  const total = sections * FIXTURE_SPOTS_PER_SECTION;
  const marked = new Map([
    [Math.floor(total / 2), 'first'],
    [total - 3, 'last'],
  ]);
  const lines = [
    "import type { WorkReport } from '@shinsa/core';",
    '',
    `export const LARGE_REVIEW_${name}_COUNT = ${total};`,
    '',
    'export const LARGE_REVIEW_REPORT: WorkReport = {',
    "  headline: 'A recorded review of a large change, kept to check the review stays fast.',",
    '  sections: [',
  ];
  for (let section = 0; section < sections; section += 1) {
    lines.push('    {', `      title: 'Recorded section ${section + 1}',`);
    lines.push(`      summary: 'Section ${section + 1} of the recorded review.',`, '      spots: [');
    for (let spot = 0; spot < FIXTURE_SPOTS_PER_SECTION; spot += 1) {
      const number = section * FIXTURE_SPOTS_PER_SECTION + spot;
      const start = 1 + Math.floor(random() * 400);
      const place = marked.get(number);
      const why = place ? `The ${place} review ${word} in this file.` : pick(FIXTURE_WHY);
      lines.push(
        '        {',
        `          file: '${pick(FIXTURE_FILES)}',`,
        `          start: ${start},`,
        `          end: ${start + Math.floor(random() * 12)},`,
        `          attention: '${pick(FIXTURE_ATTENTION)}',`,
        `          why: '${why}',`,
        '        },'
      );
    }
    lines.push('      ],', '    },');
  }
  lines.push('  ],', '  checks: [],', '  judgementCalls: [],', '};', '');
  return lines.join('\n');
}
