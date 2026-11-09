const WEB_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

export function resolveSignInSite(url: string) {
  if (!URL.canParse(url)) return null;
  const parsed = new URL(url);
  return WEB_PROTOCOLS.has(parsed.protocol) ? parsed.hostname : null;
}
