import { LanguageDescription, type LanguageSupport } from '@codemirror/language';
import { languages } from '@codemirror/language-data';

const loaded = new Map<string, Promise<LanguageSupport | null>>();

export function selectLanguageDescription(path: string, list: readonly LanguageDescription[] = languages) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return LanguageDescription.matchFilename(list, name);
}

export function requestLanguage(
  path: string,
  list: readonly LanguageDescription[] = languages
): Promise<LanguageSupport | null> {
  const description = selectLanguageDescription(path, list);
  if (!description) return Promise.resolve(null);
  const known = loaded.get(description.name);
  if (known) return known;
  const pending = description.load().catch(() => null);
  loaded.set(description.name, pending);
  return pending;
}
