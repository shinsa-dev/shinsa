interface LocalOnlyRoute {
  pattern: RegExp;
  writesOnly: boolean;
}

const LOCAL_ONLY_ROUTES: LocalOnlyRoute[] = [
  { pattern: /^\/api\/remote(?:\/(?!requests\/)|$)/, writesOnly: true },
  { pattern: /^\/api\/accounts(?:\/|$)/, writesOnly: true },
  { pattern: /^\/api\/extensions(?:\/|$)/, writesOnly: true },
  { pattern: /^\/api\/mcp(?:\/|$)/, writesOnly: false },
  { pattern: /^\/api\/secrets\//, writesOnly: true },
  { pattern: /^\/api\/schedules\/[^/]+\/webhook$/, writesOnly: true },
  { pattern: /^\/api\/versions\/update$/, writesOnly: true },
  { pattern: /^\/api\/tasks\/[^/]+\/open$/, writesOnly: true },
  { pattern: /^\/api\/engine\//, writesOnly: true },
  { pattern: /^\/api\/onboarding(?:\/|$)/, writesOnly: true },
  { pattern: /^\/api\/(?:terminals|services)(?:\/|$)/, writesOnly: false },
];

export function resolveLocalOnlyRoute(method: string, pathname: string) {
  const writes = method !== 'GET' && method !== 'HEAD';
  return LOCAL_ONLY_ROUTES.some((route) => route.pattern.test(pathname) && (writes || !route.writesOnly));
}
