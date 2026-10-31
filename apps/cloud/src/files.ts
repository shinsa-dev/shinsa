import type { CloudWorld } from './world.ts';

export function resolveFileKey(instanceId: string, hash: string) {
  return `files/${instanceId}/${hash}`;
}

export async function removeInstanceFiles(instanceId: string, world: CloudWorld) {
  const hashes = await world.store.listInstanceFileHashes(instanceId);
  if (hashes.length > 0) await world.files.remove(hashes.map((hash) => resolveFileKey(instanceId, hash)));
}
