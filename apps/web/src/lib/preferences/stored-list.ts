import { Option, Predicate, Schema } from 'effect';
import { StoredListText } from '@/lib/preferences/schema.ts';

const decodeStoredList = Schema.decodeUnknownOption(StoredListText);

export function listStoredStrings(key: string): string[] {
  const stored = Option.getOrUndefined(decodeStoredList(localStorage.getItem(key))) ?? [];
  return stored.filter(Predicate.isString);
}
