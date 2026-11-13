import { Option } from 'effect';

const WEB_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

function parseWebUrl(url: string) {
  return Option.fromNullishOr(URL.parse(url)).pipe(
    Option.filter((parsed) => WEB_PROTOCOLS.has(parsed.protocol))
  );
}

export function resolveSignInSite(url: string): Option.Option<string> {
  return parseWebUrl(url).pipe(Option.map((parsed) => parsed.hostname));
}

export function isLocalSignInUrl(url: string) {
  return parseWebUrl(url).pipe(
    Option.exists(
      (parsed) =>
        parsed.port !== '' || LOOPBACK_HOSTS.has(parsed.hostname) || parsed.hostname.endsWith('.localhost')
    )
  );
}

export function isSameOrigin(requested: string, landed: string) {
  return Option.all([parseWebUrl(requested), parseWebUrl(landed)]).pipe(
    Option.exists(([from, to]) => from.origin === to.origin)
  );
}
