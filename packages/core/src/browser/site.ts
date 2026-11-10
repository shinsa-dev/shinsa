import { Option } from 'effect';

const WEB_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

export function resolveSignInSite(url: string): Option.Option<string> {
  return Option.fromNullishOr(URL.parse(url)).pipe(
    Option.filter((parsed) => WEB_PROTOCOLS.has(parsed.protocol)),
    Option.map((parsed) => parsed.hostname)
  );
}
