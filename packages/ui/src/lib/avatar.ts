export type PastelVariant = 'tile' | 'orb';

/**
 * Two palettes, so a workspace and a person never look alike even from the
 * same seed. Tiles (workspaces) blend two *neighboring* accent ramps; orbs
 * (people) stay inside one ramp, lit from a corner, and use a different hash,
 * so the same string lands on different colors in each.
 */
const TILE_PAIRS = [
  ['purple', 'pink'],
  ['sky', 'blue'],
  ['green', 'yellow'],
  ['amber', 'orange'],
  ['pink', 'orange'],
  ['blue', 'purple'],
  ['yellow', 'green'],
  ['sky', 'purple'],
] as const;

const ORB_HUES = ['purple', 'sky', 'blue', 'green', 'amber', 'orange', 'pink', 'yellow'] as const;

const TILE_SALT = 84696351;
const ORB_SALT = 2166136261;

function hash(seed: string, salt: number): number {
  let value = salt;
  for (let index = 0; index < seed.length; index++) {
    value = Math.imul(value ^ seed.charCodeAt(index), 16777619) >>> 0;
  }
  return value;
}

/** The two accent ramps a seed paints with; an orb's two are the same hue. */
export function resolvePastelPair(seed: string, variant: PastelVariant = 'tile'): readonly [string, string] {
  if (variant === 'orb') {
    const hue = ORB_HUES[hash(seed, ORB_SALT) % ORB_HUES.length] as string;
    return [hue, hue];
  }
  return TILE_PAIRS[hash(seed, TILE_SALT) % TILE_PAIRS.length] as readonly [string, string];
}

/**
 * One gradient stop. In dark mode the ramp's `-2` / `-3` stops turn deep and
 * saturated, so each stop is picked with `light-dark()`: the ramp itself by
 * day, the accent `-4` lifted toward white by night, which lands on the same
 * pastel lightness. It reads the raw ramp variables (`--sky-2`), not the
 * `--color-*` theme aliases: Tailwind drops theme variables no class uses.
 */
export function resolvePastelStop(hue: string, step: 2 | 3): string {
  const lift = step === 2 ? 45 : 25;
  return `light-dark(var(--${hue}-${step}), color-mix(in oklab, var(--${hue}-4), white ${lift}%))`;
}

/** The generated face for a person without a picture, stable per name. */
export function resolveAvatarUrl(name: string): string {
  const key = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'anonymous';
  return `https://api.kodama.sh/${key}?size=128&shape=circle&depth=subtle&mood=happy,surprised,cool&animations=blink,eyebrowBounce`;
}
