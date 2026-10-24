import type { DesktopNotice } from './bridge.ts';
import { isAppPath } from './navigation.ts';

const TITLE_MAX = 120;

const BODY_MAX = 240;

const TAG_MAX = 120;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function cut(text: string, max: number) {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export function parseNotice(payload: unknown): DesktopNotice | null {
  if (!isRecord(payload)) return null;
  const { title, body, tag, path } = payload;
  if (typeof title !== 'string' || !title.trim()) return null;
  if (typeof body !== 'string' || typeof tag !== 'string' || !tag) return null;
  if (path !== null && !isAppPath(path)) return null;
  return {
    title: cut(title.trim(), TITLE_MAX),
    body: cut(body.trim(), BODY_MAX),
    tag: tag.slice(0, TAG_MAX),
    path,
  };
}
