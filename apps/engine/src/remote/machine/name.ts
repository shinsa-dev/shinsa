import { hostname } from 'node:os';

export function resolveMachineName(name = hostname()) {
  const bare = name.replace(/\.local$/i, '');
  if (!bare) return 'Machine';
  if (bare !== bare.toUpperCase()) return bare;
  return bare
    .toLowerCase()
    .replace(/(^|[\s-])(\p{L})/gu, (_, gap: string, letter: string) => gap + letter.toUpperCase());
}
