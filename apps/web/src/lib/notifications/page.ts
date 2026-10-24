import { type PageAttention, resolveWindowTitle } from './attention.ts';

function writeMetaTag(name: string, content: string) {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!tag) {
    tag = document.createElement('meta');
    tag.name = name;
    document.head.append(tag);
  }
  tag.content = content;
}

export function writePageAttention({ status, badge }: PageAttention, subject: string | null = null) {
  document.title = resolveWindowTitle(badge, subject);
  writeMetaTag('floaty:status', status);
  writeMetaTag('floaty:badge', String(badge));
}
