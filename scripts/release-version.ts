import { resolveVersionOrder } from '../packages/core/src/protocol/engine.ts';

export type ReleaseChannel = 'stable' | 'beta' | 'canary';

export type ReleaseBump = 'patch' | 'minor' | 'major';

export interface ReleasePlan {
  channel: ReleaseChannel;
  version: string;
  tag: string;
  prerelease: boolean;
  lastStable: string | null;
  notesStartTag: string | null;
}

const CHANNELS: readonly ReleaseChannel[] = ['stable', 'beta', 'canary'];

const BUMPS: readonly ReleaseBump[] = ['patch', 'minor', 'major'];

const STABLE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

const RELEASE_TAG = /^v\d+\.\d+\.\d+(-beta\.\d+)?$/;

const CANARY_TAG = /^v?\d+\.\d+\.\d+-canary\.\d+$/;

export const BETA_DOWNLOAD_URL = 'https://shinsa.dev/download/beta';

export const CANARY_DOWNLOAD_URL = 'https://shinsa.dev/download/canary';

export const CANARIES_KEPT = 5;

export const CANARY_IGNORED_PATHS = [
  'docs/**',
  'apps/marketing/**',
  '*.md',
  '**/CLAUDE.md',
  '.claude/**',
  '.github/assets/**',
] as const;

const IGNORED_GLOBS = CANARY_IGNORED_PATHS.map((pattern) => new Bun.Glob(pattern));

export type CanaryDecision =
  | { build: true; reason: 'first' | 'changed'; base: string | null; files: string[] }
  | { build: false; reason: 'unchanged'; base: string; files: string[] };

export function parseReleaseOptions(channel: string | undefined, bump: string | undefined) {
  const parsedChannel = CHANNELS.find((entry) => entry === channel);
  const parsedBump = BUMPS.find((entry) => entry === bump);
  if (!parsedChannel) throw new Error(`The channel must be stable, beta or canary, not "${channel ?? ''}".`);
  if (!parsedBump) throw new Error(`The bump must be patch, minor or major, not "${bump ?? ''}".`);
  return { channel: parsedChannel, bump: parsedBump };
}

function selectNewest(tags: readonly string[], pattern: RegExp) {
  const versions = tags.filter((tag) => pattern.test(tag)).map((tag) => tag.slice(1));
  return versions.reduce<string | null>(
    (last, version) => (last === null || resolveVersionOrder(version, last) === 1 ? version : last),
    null
  );
}

function bumpVersion(version: string, bump: ReleaseBump) {
  const [major = 0, minor = 0, patch = 0] = version.replace(/-.*$/, '').split('.').map(Number);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function countPrereleases(tags: readonly string[], base: string, identifier: 'beta' | 'canary') {
  const pattern = new RegExp(`^v${base.replaceAll('.', '\\.')}-${identifier}\\.(\\d+)$`);
  return tags.reduce((highest, tag) => Math.max(highest, Number(pattern.exec(tag)?.[1] ?? 0)), 0);
}

function resolveCanaryBase(tags: readonly string[]) {
  const newest = selectNewest(tags, RELEASE_TAG) ?? '0.0.0';
  const beta = /^(\d+\.\d+\.\d+)-beta\.\d+$/.exec(newest);
  return beta?.[1] ?? bumpVersion(newest, 'patch');
}

function resolveCanaryPlan(tags: readonly string[], lastStable: string | null): ReleasePlan {
  const base = resolveCanaryBase(tags);
  const version = `${base}-canary.${countPrereleases(tags, base, 'canary') + 1}`;
  const notesStartTag = selectLastCanaryTag(tags);
  return { channel: 'canary', version, tag: `v${version}`, prerelease: true, lastStable, notesStartTag };
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
  const lastStable = selectNewest(tags, STABLE_TAG);
  if (channel === 'canary') return resolveCanaryPlan(tags, lastStable);
  const base = bumpVersion(lastStable ?? '0.0.0', bump);
  const version = channel === 'stable' ? base : `${base}-beta.${countPrereleases(tags, base, 'beta') + 1}`;
  const notesStartTag = channel === 'stable' && lastStable ? `v${lastStable}` : null;
  return { channel, version, tag: `v${version}`, prerelease: channel === 'beta', lastStable, notesStartTag };
}

export function describeReleaseChannel(plan: ReleasePlan) {
  if (plan.channel === 'stable')
    return `**Stable release.** Shinsa updates itself to ${plan.version} on the Stable and Beta channels, unless it already runs a newer beta. Shinsa Canary stays on canaries.`;
  if (plan.channel === 'canary')
    return `**Canary build of main.** Shinsa Canary updates itself to it. It is a separate app beside Shinsa, with its own data and engine. Download it at ${CANARY_DOWNLOAD_URL}.`;
  const base = plan.version.replace(/-beta\.\d+$/, '');
  return `**Beta of Shinsa ${base}.** Shinsa on the Beta channel updates itself to it, unless it already runs a newer version (Settings → General → Updates). Download it at ${BETA_DOWNLOAD_URL}.`;
}

export function isAppChange(path: string) {
  return !IGNORED_GLOBS.some((glob) => glob.match(path));
}

export function selectLastCanaryTag(tags: readonly string[]) {
  const version = selectNewest(tags, CANARY_TAG);
  return version ? `v${version}` : null;
}

export function resolveCanaryDecision(base: string | null, changed: readonly string[]): CanaryDecision {
  const files = changed.filter(isAppChange);
  if (base === null) return { build: true, reason: 'first', base, files };
  return files.length > 0
    ? { build: true, reason: 'changed', base, files }
    : { build: false, reason: 'unchanged', base, files };
}

export function describeCanaryDecision(decision: CanaryDecision) {
  if (decision.reason === 'first') return 'Building a canary: there is no canary before it.';
  if (decision.reason === 'unchanged')
    return `No canary: nothing since ${decision.base} changes the app, only docs, the site or agent notes.`;
  const shown = decision.files.slice(0, 5).map((file) => `\`${file}\``);
  const more = decision.files.length - shown.length;
  return `Building a canary: since ${decision.base}, ${shown.join(', ')}${more > 0 ? ` and ${more} more` : ''} changed.`;
}

export function listStaleCanaries(versions: readonly string[], kept = CANARIES_KEPT) {
  return versions
    .filter((tag) => CANARY_TAG.test(tag))
    .sort((a, b) => resolveVersionOrder(b, a) ?? 0)
    .slice(kept);
}
