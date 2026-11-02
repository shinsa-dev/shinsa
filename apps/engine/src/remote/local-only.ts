const OWNER_ONLY_PATHS: ReadonlySet<string> = new Set(['/api/remote/teams/join']);

export function isOwnerOnlyRoute(method: string, pathname: string) {
  return method === 'POST' && OWNER_ONLY_PATHS.has(pathname);
}
