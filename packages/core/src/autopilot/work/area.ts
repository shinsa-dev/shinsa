import { Option } from 'effect';

const WORKSPACE_FOLDERS: ReadonlySet<string> = new Set([
  'apps',
  'packages',
  'services',
  'libs',
  'crates',
  'modules',
]);

const GENERIC_FOLDERS: ReadonlySet<string> = new Set([
  'src',
  'lib',
  'app',
  'source',
  'sources',
  'components',
  'routes',
  'pages',
  'screens',
  'views',
  'test',
  'tests',
  '__tests__',
  'spec',
]);

const SUPPORTING_PATH = /(?:^|\/)(?:docs|\.changes|test|tests|__tests__)\/|\.(?:test|spec)\.[a-z]+$|\.md$/i;

function resolveStem(name: string) {
  const dot = name.indexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

export function selectWorkPathArea(path: string): Option.Option<string> {
  const segments = path.split('/').filter((segment) => segment.length > 0 && segment !== '.');
  const file = segments.pop();
  if (file === undefined) return Option.none();
  const rootSize = segments.length >= 2 && WORKSPACE_FOLDERS.has(segments[0] ?? '') ? 2 : 1;
  const root = segments.slice(0, rootSize);
  const module =
    segments.slice(rootSize).find((segment) => !GENERIC_FOLDERS.has(segment)) ?? resolveStem(file);
  return Option.some([...root, module].join('/').toLowerCase());
}

export function isSupportingWorkPath(path: string) {
  return SUPPORTING_PATH.test(path);
}

export function selectWorkArea(paths: readonly string[]): Option.Option<string> {
  const main = paths.filter((path) => !isSupportingWorkPath(path));
  const counts = new Map<string, number>();
  for (const path of main.length > 0 ? main : paths) {
    for (const area of Option.toArray(selectWorkPathArea(path))) {
      counts.set(area, (counts.get(area) ?? 0) + 1);
    }
  }
  let best: Option.Option<string> = Option.none();
  let most = 0;
  for (const [area, count] of counts) {
    if (count > most) {
      best = Option.some(area);
      most = count;
    }
  }
  return best;
}
