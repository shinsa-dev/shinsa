import type { RunRole } from '@shinsa/core';

export const REPLIES_SHOWN = 3;

export const REPLY_LIMIT = 1_500;

export interface TaskReply {
  at: number;
  role: RunRole;
  text: string;
}
