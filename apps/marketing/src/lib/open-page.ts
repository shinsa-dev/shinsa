import type { ReviewPayload, ShinsaState, Task } from '@shinsa/core';
import { Effect, Option } from 'effect';
import { createOpenState } from './open-scene.ts';
import { type InviteHeader, readReviewFragment, resolveInviteHeader } from './open.ts';

export interface OpenScene {
  state: ShinsaState;
  task: Task;
  payload: ReviewPayload;
  link: string | null;
}

export type OpenPage = { scene: OpenScene } | { header: InviteHeader };

export const readOpenPage = Effect.fn('readOpenPage')(function* (
  search: string,
  hash: string,
  now: number
): Effect.fn.Return<OpenPage> {
  const header = resolveInviteHeader(search);
  const payload = yield* readReviewFragment(hash);
  if (Option.isNone(payload)) return { header };
  return { scene: { ...createOpenState(payload.value, now), payload: payload.value, link: header.link } };
});
