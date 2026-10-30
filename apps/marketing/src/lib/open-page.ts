import type { ReviewPayload, ShinsaState, Task } from '@shinsa/core';
import { type InviteHeader, readReviewFragment, resolveInviteHeader } from './open.ts';
import { createOpenState } from './open-scene.ts';

export interface OpenScene {
  state: ShinsaState;
  task: Task;
  payload: ReviewPayload;
  link: string | null;
}

export type OpenPage = { scene: OpenScene } | { header: InviteHeader };

export async function readOpenPage(search: string, hash: string, now: number): Promise<OpenPage> {
  const header = resolveInviteHeader(search);
  const payload = await readReviewFragment(hash);
  if (!payload) return { header };
  return { scene: { ...createOpenState(payload, now), payload, link: header.link } };
}
