import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SAMPLE_EVIDENCE_LAYOUT,
  SAMPLE_EVIDENCE_TEXTS,
  SAMPLE_REVISED_EVIDENCE_LAYOUT,
  SAMPLE_REVISED_EVIDENCE_TEXTS,
} from '@/routes/ui/sample-evidence.ts';

const PUBLIC = join(import.meta.dirname, '..', '..', '..', 'public');

describe('the /ui evidence samples', () => {
  it('open the same text as the panel shows, from a file the web app serves', () => {
    for (const [uri, body] of [...SAMPLE_EVIDENCE_TEXTS, ...SAMPLE_REVISED_EVIDENCE_TEXTS]) {
      expect(readFileSync(join(PUBLIC, uri), 'utf8')).toBe(`${body}\n`);
    }
    const texts = SAMPLE_EVIDENCE_LAYOUT.groups
      .flatMap((group) => group.entries.flatMap((entry) => entry.parts))
      .filter((view) => view.media === 'text');
    expect(texts.map((view) => view.evidence.uri)).toEqual(SAMPLE_EVIDENCE_TEXTS.map(([uri]) => uri));
  });

  it('show every kind of evidence once, a comparison counted as one item', () => {
    expect(SAMPLE_EVIDENCE_LAYOUT.groups.map((group) => group.label)).toEqual([
      'Comparison',
      'Recording',
      'Screenshot',
      'Test',
      'Check',
      'Note',
      'Preview',
    ]);
    expect(SAMPLE_EVIDENCE_LAYOUT.count).toBe(7);
  });

  it('show a revision: the shot taken again marked as updated, the earlier one and a removed note folded', () => {
    expect(SAMPLE_REVISED_EVIDENCE_LAYOUT.count).toBe(1);
    expect(SAMPLE_REVISED_EVIDENCE_LAYOUT.groups[0]?.entries[0]?.updated).toBe('Updated after your review');
    expect(SAMPLE_REVISED_EVIDENCE_LAYOUT.earlier.map((entry) => entry.status)).toEqual([
      'Replaced by a later version',
      'Removed: The disabled labels are raised now, as you asked.',
    ]);
    expect(SAMPLE_REVISED_EVIDENCE_LAYOUT.earlier[1]?.parts[0]?.evidence.uri).toBe(
      SAMPLE_REVISED_EVIDENCE_TEXTS[0]?.[0]
    );
  });
});
