import type { OnboardingChoice } from '@shinsa/core';
import type { Asked } from './questions.ts';

type Confirmation = 'yes' | 'no';

const AGREEING = new Set([
  'y',
  'yes',
  'yeah',
  'yep',
  'yup',
  'ya',
  'sure',
  'ok',
  'okay',
  'correct',
  'right',
  'exactly',
  'confirm',
  'confirmed',
  'perfect',
  'great',
  'good',
  'fine',
  'absolutely',
  'definitely',
  'indeed',
]);

const AGREEING_FILLER = new Set([
  ...AGREEING,
  'that',
  "that's",
  'is',
  'it',
  'all',
  'looks',
  'look',
  'sounds',
  'sound',
  'please',
  'thanks',
  'thank',
  'you',
  'go',
  'ahead',
  'do',
  "let's",
  'lets',
  'spot',
  'on',
  'of',
  'course',
  'totally',
  'very',
  'much',
  'thing',
]);

const REFUSING = new Set(['n', 'no', 'nope', 'nah', 'wrong', 'incorrect', 'not']);

const REFUSING_FILLER = new Set([
  ...REFUSING,
  'quite',
  'really',
  'right',
  'correct',
  'that',
  "that's",
  'it',
  'is',
  "isn't",
  'please',
  'thanks',
  'ask',
  'try',
  'again',
]);

const SKIP =
  /^(?:skip(?: (?:it|this|this one|this question|that|for now))?|pass|later|not now|next|(?:i )?don't (?:know|mind|care)|dunno|no idea|not sure|no preference|(?:it )?doesn't matter|whatever|any|either|anything|you (?:choose|decide|pick)|up to you|(?:keep|leave) (?:it|that|this|what you have|the current one|the current setting)(?: as (?:it is|is)| the same| unchanged)?|(?:use |keep )?(?:the )?(?:default|current)(?: one| setting| value| option)?|as is|same as now|unchanged)$/;

const LEAD =
  /^(?:(?:please|ok|okay|so|well|i think|i guess)\s+)*(?:(?:i(?:'d| would)? (?:like|want|prefer|pick|choose|go with|take)|i'll (?:take|go with|use)|let's (?:go with|use|do)|go with|use|pick|choose|select|take|switch to|set it to|make it)\s+)?(?:the\s+)?/;

const TRAIL = /(?:\s+(?:please|thanks|thank you|for me|i think|by default|then))+$/;

const NEGATIONS = new Set(['no', 'not', "don't", 'never', 'instead', 'except', 'without', 'rather', 'but']);

const FOLDER_FILLER = new Set([
  'the',
  'and',
  'my',
  'both',
  'in',
  'plus',
  'also',
  'with',
  'folder',
  'folders',
  'directory',
  'directories',
  'dir',
  'dirs',
  'one',
  'ones',
]);

const KEY = /^[a-z][a-z0-9.-]*$/;

function normaliseAnswer(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\b(do|does|is)nt\b/g, "$1n't")
    .replace(/\bthats\b/g, "that's")
    .replace(/[.!?]+$/, '')
    .replace(/\s+/g, ' ');
}

function listTokens(text: string) {
  return text.split(/[^a-z0-9.'-]+/).filter(Boolean);
}

function resolveCore(text: string) {
  return normaliseAnswer(text).replace(LEAD, '').replace(TRAIL, '').trim();
}

export function parseConfirmation(text: string): Confirmation | null {
  const normalised = normaliseAnswer(text);
  if (normalised === 'ask again' || normalised === 'try again') return 'no';
  const words = listTokens(normalised);
  const agrees = words.every((word) => AGREEING_FILLER.has(word)) && words.some((word) => AGREEING.has(word));
  const refuses =
    words.every((word) => REFUSING_FILLER.has(word)) && words.some((word) => REFUSING.has(word));
  if (agrees === refuses) return null;
  return agrees ? 'yes' : 'no';
}

export function isSkip(text: string) {
  return SKIP.test(normaliseAnswer(text).replace(TRAIL, ''));
}

function selectChoice(asked: Asked, value: string) {
  return asked.choices.find((choice) => choice.value === value) ?? null;
}

export function resolveConfirmedChoice(text: string, asked: Asked): string[] | 'keep' | null {
  const confirmation = parseConfirmation(text);
  if (!confirmation || asked.multiple) return null;
  const named = selectChoice(asked, confirmation);
  if (named) return [named.value];
  if (confirmation === 'no') return null;
  const [first] = asked.choices;
  if (first?.value === 'continue') return [first.value];
  return selectChoice(asked, 'continue') ? null : 'keep';
}

function listKeys(choice: OnboardingChoice) {
  const value = choice.value.toLowerCase();
  const [first] = listTokens(choice.label.toLowerCase());
  return [KEY.test(value) ? value : null, first && first.length >= 3 ? first : null].filter(
    (key): key is string => key !== null
  );
}

function matchNamedChoice(core: string, asked: Asked) {
  const words = listTokens(core);
  const named = asked.choices.filter((choice) => listKeys(choice).some((key) => words.includes(key)));
  const [only] = named;
  if (named.length !== 1 || !only) return null;
  const keys = listKeys(only);
  if (!keys.includes(words[0] ?? '')) return null;
  if (words.some((word) => NEGATIONS.has(word) && !keys.includes(word))) return null;
  return [only.value];
}

function resolveFolderName(path: string) {
  return path.split('/').filter(Boolean).at(-1)?.toLowerCase() ?? '';
}

function matchNamedFolders(core: string, asked: Asked) {
  const words = listTokens(core).filter((word) => !FOLDER_FILLER.has(word));
  if (words.length === 0) return null;
  const values: string[] = [];
  for (const word of words) {
    const named = asked.choices.filter((choice) => resolveFolderName(choice.value) === word);
    const [only] = named;
    if (named.length !== 1 || !only) return null;
    if (!values.includes(only.value)) values.push(only.value);
  }
  return values;
}

function matchPaths(text: string) {
  const parts = text
    .split(/,|\n|\s+and\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 && parts.every((part) => part.startsWith('/') || part.startsWith('~'))
    ? parts
    : null;
}

export function matchChoices(text: string, asked: Asked): string[] | null {
  const core = resolveCore(text);
  for (const wanted of [normaliseAnswer(text), core]) {
    const choice = asked.choices.find(
      (entry) => entry.value.toLowerCase() === wanted || entry.label.toLowerCase() === wanted
    );
    if (choice) return [choice.value];
  }
  if (!asked.multiple) return matchNamedChoice(core, asked);
  return matchPaths(text) ?? matchNamedFolders(core, asked);
}
