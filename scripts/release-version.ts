import { resolveVersionOrder } from '../packages/core/src/protocol/engine.ts';

export type ReleaseChannel = 'stable' | 'beta';

export type ReleaseBump = 'patch' | 'minor' | 'major';

export interface ReleasePlan {
  channel: ReleaseChannel;
  version: string;
  tag: string;
  prerelease: boolean;
  lastStable: string | null;
  notesStartTag: string | null;
}

const CHANNELS: readonly ReleaseChannel[] = ['stable', 'beta'];

const BUMPS: readonly ReleaseBump[] = ['patch', 'minor', 'major'];

const STABLE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

export const BETA_DOWNLOAD_URL = 'https://shinsa.dev/download/beta';

export function parseReleaseOptions(channel: string | undefined, bump: string | undefined) {
  const parsedChannel = CHANNELS.find((entry) => entry === channel);
  const parsedBump = BUMPS.find((entry) => entry === bump);
  if (!parsedChannel) throw new Error(`The channel must be stable or beta, not "${channel ?? ''}".`);
  if (!parsedBump) throw new Error(`The bump must be patch, minor or major, not "${bump ?? ''}".`);
  return { channel: parsedChannel, bump: parsedBump };
}

function selectLastStable(tags: readonly string[]) {
  const stable = tags.filter((tag) => STABLE_TAG.test(tag)).map((tag) => tag.slice(1));
  return stable.reduce<string | null>(
    (last, version) => (last === null || resolveVersionOrder(version, last) === 1 ? version : last),
    null
  );
}

function bumpVersion(version: string, bump: ReleaseBump) {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function countBetas(tags: readonly string[], base: string) {
  const pattern = new RegExp(`^v${base.replaceAll('.', '\\.')}-beta\\.(\\d+)$`);
  return tags.reduce((highest, tag) => Math.max(highest, Number(pattern.exec(tag)?.[1] ?? 0)), 0);
}

export function resolveReleasePlan({
  tags,
  channel,
  bump,
}: {
  tags: readonly string[];
  channel: ReleaseChannel;
  bump: ReleaseBump;
}): ReleasePlan {
  const lastStable = selectLastStable(tags);
  const base = bumpVersion(lastStable ?? '0.0.0', bump);
  const version = channel === 'stable' ? base : `${base}-beta.${countBetas(tags, base) + 1}`;
  const notesStartTag = channel === 'stable' && lastStable ? `v${lastStable}` : null;
  return { channel, version, tag: `v${version}`, prerelease: channel === 'beta', lastStable, notesStartTag };
}

export function describeReleaseChannel(plan: ReleasePlan) {
  if (plan.channel === 'stable')
    return `**Stable release.** Shinsa updates itself to ${plan.version} on the Stable channel, and on the Beta channel unless it already runs a newer beta.`;
  const base = plan.version.replace(/-beta\.\d+$/, '');
  return `**Beta of Shinsa ${base}.** Only Shinsa on the Beta channel updates itself to it (Settings → General → Updates). Download it at ${BETA_DOWNLOAD_URL}.`;
}
