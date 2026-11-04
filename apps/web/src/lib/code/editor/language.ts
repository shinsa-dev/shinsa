import { LanguageDescription, type LanguageSupport } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { Effect } from 'effect';
import { runApp } from '@/lib/runtime/app.ts';

const loaded = new Map<string, Promise<LanguageSupport | null>>();

const readLanguage = Effect.fn('Language.read')(function* (description: LanguageDescription) {
  return yield* Effect.tryPromise(() => description.load()).pipe(Effect.orElseSucceed(() => null));
});

export function selectLanguageDescription(path: string, list: readonly LanguageDescription[] = languages) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return LanguageDescription.matchFilename(list, name);
}

export function requestLanguage(
  path: string,
  list: readonly LanguageDescription[] = languages
): Promise<LanguageSupport | null> {
  const description = selectLanguageDescription(path, list);
  if (!description) return runApp(Effect.succeed(null));
  const known = loaded.get(description.name);
  if (known) return known;
  const pending = runApp(readLanguage(description));
  loaded.set(description.name, pending);
  return pending;
}
