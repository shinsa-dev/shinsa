const MARKDOWN_EXTENSIONS = ['.md', '.mdx', '.markdown'];

const SCHEME = /^[a-z][a-z\d+.-]*:/i;

const LINE_ANCHOR = /^L(\d+)(?:-L?\d+)?$/;

export interface FileLink {
  path: string;
  line: number | null;
}

export function isMarkdownPath(path: string) {
  const lower = path.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function isExternalHref(href: string) {
  return SCHEME.test(href) || href.startsWith('//');
}

function joinSegments(from: string, target: string) {
  const start = target.startsWith('/') ? [] : from.split('/').slice(0, -1);
  const segments = [...start];
  for (const segment of target.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return null;
      segments.pop();
    } else segments.push(segment);
  }
  return segments.length > 0 ? segments.join('/') : null;
}

function decodeAscii(text: string) {
  return text.replace(/%([0-7][\da-f])/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

export function resolveFileLink(from: string, href: string | undefined): FileLink | null {
  if (!href || isExternalHref(href) || href.startsWith('#')) return null;
  const [beforeHash = '', hash = ''] = href.split('#', 2);
  const target = beforeHash.split('?', 1)[0] ?? '';
  if (!target) return null;
  const path = joinSegments(from, decodeAscii(target));
  if (!path) return null;
  const line = LINE_ANCHOR.exec(hash)?.[1];
  return { path, line: line ? Number(line) : null };
}

export function resolveImagePath(from: string, src: string | undefined) {
  if (!src || isExternalHref(src)) return null;
  return resolveFileLink(from, src)?.path ?? null;
}
