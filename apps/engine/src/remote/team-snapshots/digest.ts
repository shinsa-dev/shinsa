import { createHash } from 'node:crypto';

export function resolveKeyDigest(key: string) {
  return createHash('sha256').update(key).digest('hex');
}
