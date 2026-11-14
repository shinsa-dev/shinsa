import { Option } from 'effect';
import type { AutopilotWorkNovelty } from './schema.ts';

const NEW_WORDS =
  /(?<![a-z])(?:new|create|creates|introduce|introduces|implement|implements|launch|feature|flow|flows|redesign|rework|rewrite|initiative|system|from scratch)(?![a-z])/gi;

const TWEAK_WORDS =
  /(?<![a-z])(?:fix|fixes|tweak|tweaks|adjust|adjusts|rename|renames|polish|tidy|small|minor|typo|typos|copy|bump|nudge|align|spacing|padding|margin|color|colour|tiny|little|quick|wording|label|labels)(?![a-z])/gi;

function countMatches(text: string, pattern: RegExp) {
  return text.match(pattern)?.length ?? 0;
}

export function selectWorkNovelty(text: string): Option.Option<AutopilotWorkNovelty> {
  const fresh = countMatches(text, NEW_WORDS);
  const tweak = countMatches(text, TWEAK_WORDS);
  if (fresh > tweak) return Option.some('new');
  if (tweak > fresh) return Option.some('tweak');
  return Option.none();
}
