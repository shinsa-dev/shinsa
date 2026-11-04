import { ESCAPES, OSC_LINK, URL_PATTERN } from './schema.ts';

export function parseLoginUrl(transcript: string) {
  const linked = [...transcript.matchAll(OSC_LINK)].map((match) => match[1] ?? '');
  const visible = transcript.replace(ESCAPES, '').match(URL_PATTERN) ?? [];
  return [...linked, ...visible].find((url) => url.includes('oauth') && url.includes('authorize')) ?? null;
}

export function describeTail(transcript: string) {
  const lines = transcript
    .replace(ESCAPES, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.at(-1) ?? 'it printed nothing';
}
