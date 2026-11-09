import { type ContextMenuEntry, type ContextMenuParams, LOOK_UP_LENGTH, SUGGESTION_LIMIT } from './schema.ts';

const separator: ContextMenuEntry = { kind: 'separator' };

function describeLookUp(selection: string) {
  const text = selection.replace(/\s+/g, ' ');
  return text.length > LOOK_UP_LENGTH ? `${text.slice(0, LOOK_UP_LENGTH - 1).trimEnd()}…` : text;
}

function listSpellingEntries({
  misspelledWord,
  dictionarySuggestions,
}: ContextMenuParams): ContextMenuEntry[] {
  if (misspelledWord === '') return [];
  const suggestions = dictionarySuggestions.slice(0, SUGGESTION_LIMIT);
  return [
    ...(suggestions.length === 0
      ? [{ kind: 'note' as const, label: 'No Guesses Found' }]
      : suggestions.map((word) => ({
          kind: 'action' as const,
          label: word,
          action: { _tag: 'Replace' as const, word },
        }))),
    separator,
    { kind: 'action', label: 'Learn Spelling', action: { _tag: 'Learn', word: misspelledWord } },
    separator,
  ];
}

function listEditEntries({ isEditable, selectionText, editFlags }: ContextMenuParams): ContextMenuEntry[] {
  if (!isEditable) return selectionText.trim() === '' ? [] : [{ kind: 'role', role: 'copy', enabled: true }];
  return [
    { kind: 'role', role: 'cut', enabled: editFlags.canCut },
    { kind: 'role', role: 'copy', enabled: editFlags.canCopy },
    { kind: 'role', role: 'paste', enabled: editFlags.canPaste },
    separator,
    { kind: 'role', role: 'selectAll', enabled: editFlags.canSelectAll },
  ];
}

function trimSeparators(entries: readonly ContextMenuEntry[]) {
  const kept: ContextMenuEntry[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'separator' || (kept.length > 0 && kept.at(-1)?.kind !== 'separator'))
      kept.push(entry);
  }
  return kept.at(-1)?.kind === 'separator' ? kept.slice(0, -1) : kept;
}

export function listContextMenuEntries(
  params: ContextMenuParams,
  { inspect }: { inspect: boolean }
): ContextMenuEntry[] {
  const selection = params.selectionText.trim();
  return trimSeparators([
    ...listSpellingEntries(params),
    ...(selection === ''
      ? []
      : [
          {
            kind: 'action' as const,
            label: `Look Up “${describeLookUp(selection)}”`,
            action: { _tag: 'LookUp' as const },
          },
          separator,
        ]),
    ...listEditEntries(params),
    ...(inspect
      ? [
          separator,
          {
            kind: 'action' as const,
            label: 'Inspect Element',
            action: { _tag: 'Inspect' as const, x: params.x, y: params.y },
          },
        ]
      : []),
  ]);
}
