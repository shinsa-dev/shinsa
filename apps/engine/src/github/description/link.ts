import { deflateRawSync } from 'node:zlib';
import {
  type Evidence,
  listReviewPayloadFits,
  type Repo,
  type ReviewPayload,
  serializeReviewPayload,
  type Task,
} from '@shinsa/core';
import { REVIEW_LINK_LIMIT } from './schema.ts';

function encodeReviewPayload(payload: ReviewPayload) {
  return deflateRawSync(Buffer.from(JSON.stringify(payload))).toString('base64url');
}

export function serializeReviewLink(task: Task, evidence: readonly Evidence[], repo: Repo | null = null) {
  for (const fit of listReviewPayloadFits(serializeReviewPayload(task, evidence, repo))) {
    const encoded = encodeReviewPayload(fit);
    if (encoded.length <= REVIEW_LINK_LIMIT) return encoded;
  }
  return null;
}
