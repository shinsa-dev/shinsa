const ELLIPSIS = '…';

const FENCE = '```';

const BOLD_MARK = '\uE001';

function escapeText(text: string) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeLink(url: string) {
  return url.replaceAll('|', '%7C').replaceAll('>', '%3E').replaceAll('<', '%3C');
}

function isSlackLinkTarget(url: string) {
  return /^(?:https?:\/\/|mailto:)/i.test(url);
}

function serializeLink(label: string, url: string) {
  const text = label.trim().length > 0 ? label : url;
  if (!isSlackLinkTarget(url)) return text;
  return `<${escapeLink(url)}|${text.replaceAll('|', '/')}>`;
}

function serializeInline(text: string) {
  const codes: string[] = [];
  const kept = text.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    codes.push(`\`${code}\``);
    return `\uE002${codes.length - 1}\uE002`;
  });
  const links: string[] = [];
  const linked = escapeText(kept).replace(
    /!?\[([^\]\n]*)\]\(([^)\s]+)\)/g,
    (_match, label: string, url: string) => {
      links.push(serializeLink(label, url.replaceAll('&amp;', '&')));
      return `\uE003${links.length - 1}\uE003`;
    }
  );
  const styled = linked
    .replace(/\*\*(.+?)\*\*/g, `${BOLD_MARK}$1${BOLD_MARK}`)
    .replace(/__(.+?)__/g, `${BOLD_MARK}$1${BOLD_MARK}`)
    .replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1_$2_')
    .replace(/~~(.+?)~~/g, '~$1~')
    .replaceAll(BOLD_MARK, '*');
  return styled
    .replace(/\uE003(\d+)\uE003/g, (_match, index: string) => links[Number(index)] ?? '')
    .replace(/\uE002(\d+)\uE002/g, (_match, index: string) => escapeText(codes[Number(index)] ?? ''));
}

function serializeLine(line: string) {
  const heading = /^#{1,6}\s+(.*)$/.exec(line);
  if (heading) return `*${serializeInline(heading[1] ?? '').replaceAll('*', '')}*`;
  const quote = /^>\s?(.*)$/.exec(line);
  if (quote) return `> ${serializeInline(quote[1] ?? '')}`;
  const bullet = /^(\s*)[-*+]\s+(?:\[([ xX])\]\s+)?(.*)$/.exec(line);
  if (bullet) {
    const depth = Math.floor((bullet[1] ?? '').length / 2);
    const box = bullet[2] === undefined ? '' : bullet[2] === ' ' ? '☐ ' : '☑ ';
    return `${'    '.repeat(depth)}${depth > 0 ? '◦' : '•'} ${box}${serializeInline(bullet[3] ?? '')}`;
  }
  if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) return '';
  return serializeInline(line);
}

function isTableLine(line: string) {
  return /^\s*\|.*\|\s*$/.test(line);
}

export function serializeSlackMrkdwn(markdown: string) {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const out: string[] = [];
  let fenced = false;
  let table: string[] = [];
  const flushTable = () => {
    if (table.length === 0) return;
    out.push(FENCE, ...table.filter((line) => !/^\s*\|[\s:|-]+\|\s*$/.test(line)).map(escapeText), FENCE);
    table = [];
  };
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      flushTable();
      fenced = !fenced;
      out.push(FENCE);
      continue;
    }
    if (fenced) {
      out.push(escapeText(line));
      continue;
    }
    if (isTableLine(line)) {
      table.push(line.trim());
      continue;
    }
    flushTable();
    out.push(serializeLine(line));
  }
  flushTable();
  if (fenced) out.push(FENCE);
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function escapeSlackText(text: string) {
  return escapeText(text);
}

function isInsideLink(text: string) {
  return text.lastIndexOf('<') > text.lastIndexOf('>');
}

function resolveCut(text: string, size: number) {
  const window = text.slice(0, size);
  const breaks = [window.lastIndexOf('\n'), window.lastIndexOf(' ')];
  const at = breaks.find((index) => index > size * 0.6) ?? size;
  let cut = window.slice(0, at).trimEnd();
  if (isInsideLink(cut)) cut = cut.slice(0, cut.lastIndexOf('<')).trimEnd();
  const entity = /&[a-z]*$/.exec(cut);
  return entity ? cut.slice(0, entity.index) : cut;
}

function closeFence(text: string) {
  return (text.match(/^```/gm) ?? []).length % 2 === 1 ? `\n${FENCE}` : '';
}

export function fitSlackText(text: string, limit: number) {
  if (text.length <= limit) return text;
  const cut = resolveCut(text, limit - ELLIPSIS.length - FENCE.length - 1);
  return `${cut}${ELLIPSIS}${closeFence(cut)}`;
}

export function fitSlackPlainText(text: string, limit: number) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1).trimEnd()}${ELLIPSIS}`;
}

function splitAt(text: string, size: number) {
  const window = text.slice(0, size);
  const at = window.lastIndexOf('\n\n') > size * 0.5 ? window.lastIndexOf('\n\n') : window.lastIndexOf('\n');
  return at > size * 0.3 ? at : -1;
}

export function listSlackChunks(text: string, size: number, total: number) {
  const chunks: string[] = [];
  let rest = text;
  let fenceOpen = false;
  while (rest.length > 0 && chunks.join('').length < total) {
    const room = Math.min(size, total - chunks.join('').length);
    if (rest.length <= room) {
      chunks.push(fenceOpen ? `${FENCE}\n${rest}` : rest);
      rest = '';
      break;
    }
    const at = splitAt(rest, room - FENCE.length * 2 - 2);
    if (at === -1) break;
    const piece = rest.slice(0, at);
    const opened = fenceOpen ? `${FENCE}\n${piece}` : piece;
    const closing = closeFence(opened);
    chunks.push(`${opened}${closing}`);
    fenceOpen = closing.length > 0;
    rest = rest.slice(at).replace(/^\n+/, '');
  }
  return { chunks, cut: rest.length > 0 };
}
