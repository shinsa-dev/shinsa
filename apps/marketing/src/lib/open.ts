import { parseReviewPayload, type ReviewPayload } from '@shinsa/core';

const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;

const TASK_HANDLE = /^[A-Z][A-Z0-9]{0,9}-\d{1,7}$/;

const TITLE_LIMIT = 120;

export interface TaskInvite {
  link: string;
  handle: string | null;
  title: string | null;
}

export function resolveTaskInvite(search: string): TaskInvite | null {
  const query = new URLSearchParams(search);
  const task = query.get('task');
  if (!task || !TASK_ID.test(task)) return null;
  const handle = query.get('handle');
  const title = query.get('title')?.replace(/\s+/g, ' ').trim().slice(0, TITLE_LIMIT) ?? '';
  return {
    link: `shinsa://task/${task}`,
    handle: handle && TASK_HANDLE.test(handle) ? handle : null,
    title: title || null,
  };
}

export async function readReviewFragment(hash: string): Promise<ReviewPayload | null> {
  const encoded = new URLSearchParams(hash.replace(/^#/, '')).get('review');
  if (!encoded || !/^[\w-]+$/.test(encoded)) return null;
  try {
    const base64 = encoded.replaceAll('-', '+').replaceAll('_', '/');
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return parseReviewPayload(JSON.parse(await new Response(stream).text()));
  } catch {
    return null;
  }
}
