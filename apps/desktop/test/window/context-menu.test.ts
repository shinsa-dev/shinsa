import { describe, expect, it } from 'bun:test';
import { listContextMenuEntries } from '../../src/window/context-menu.ts';
import type { ContextMenuEntry, ContextMenuParams } from '../../src/window/schema.ts';

const blank: ContextMenuParams = {
  isEditable: false,
  selectionText: '',
  misspelledWord: '',
  dictionarySuggestions: [],
  editFlags: { canCut: false, canCopy: false, canPaste: false, canSelectAll: false },
};

function listLabels(entries: readonly ContextMenuEntry[]) {
  return entries.map((entry) => {
    if (entry.kind === 'separator') return '-';
    if (entry.kind === 'role') return entry.enabled ? entry.role : `(${entry.role})`;
    return entry.label;
  });
}

describe('the right-click menu', () => {
  it('shows nothing on the page itself', () => {
    expect(listContextMenuEntries(blank)).toEqual([]);
  });

  it('offers Look Up and Copy for selected text', () => {
    const entries = listContextMenuEntries({ ...blank, selectionText: '  review gate \n' });
    expect(listLabels(entries)).toEqual(['Look Up “review gate”', '-', 'copy']);
    expect(entries[0]).toMatchObject({ action: { _tag: 'LookUp' } });
  });

  it('shortens a long selection in the Look Up item', () => {
    const entries = listContextMenuEntries({
      ...blank,
      selectionText: 'the agent hands over every phase   through a tool',
    });
    expect(listLabels(entries)[0]).toBe('Look Up “the agent hands over ev…”');
  });

  it('offers the edit items in a field, enabled as the field allows', () => {
    const entries = listContextMenuEntries({
      ...blank,
      isEditable: true,
      editFlags: { canCut: false, canCopy: false, canPaste: true, canSelectAll: true },
    });
    expect(listLabels(entries)).toEqual(['(cut)', '(copy)', 'paste', '-', 'selectAll']);
  });

  it('puts spelling guesses first for a misspelled word', () => {
    const entries = listContextMenuEntries({
      ...blank,
      isEditable: true,
      selectionText: 'gait',
      misspelledWord: 'gait',
      dictionarySuggestions: ['gate', 'gain', 'bait', 'wait', 'gaits', 'gaiter'],
      editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true },
    });
    expect(listLabels(entries)).toEqual([
      'gate',
      'gain',
      'bait',
      'wait',
      'gaits',
      '-',
      'Learn Spelling',
      '-',
      'Look Up “gait”',
      '-',
      'cut',
      'copy',
      'paste',
      '-',
      'selectAll',
    ]);
    expect(entries[0]).toMatchObject({ action: { _tag: 'Replace', word: 'gate' } });
    expect(entries[6]).toMatchObject({ action: { _tag: 'Learn', word: 'gait' } });
  });

  it('says when it has no guesses', () => {
    const entries = listContextMenuEntries({ ...blank, misspelledWord: 'zzz' });
    expect(listLabels(entries)).toEqual(['No Guesses Found', '-', 'Learn Spelling']);
  });
});
