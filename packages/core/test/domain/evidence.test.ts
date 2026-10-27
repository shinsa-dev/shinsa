import { describe, expect, test } from 'bun:test';
import { type Evidence, listEvidenceItems } from '../../src/index.ts';

function piece(id: string, fields: Partial<Evidence> = {}): Evidence {
  return {
    id,
    taskId: 't',
    runId: 'r',
    kind: 'screenshot',
    title: id,
    uri: `/e/${id}.png`,
    attachedAt: 0,
    ...fields,
  };
}

describe('listEvidenceItems', () => {
  test('a before and its after at the same title, width and theme are one comparison, before first', () => {
    const after = piece('after', { title: 'Settings', width: 1280, theme: 'dark', stage: 'after' });
    const before = piece('before', { title: 'Settings', width: 1280, theme: 'dark', stage: 'before' });
    const phone = piece('phone', { title: 'Settings', width: 390, theme: 'dark', stage: 'after' });
    expect(listEvidenceItems([after, before, phone])).toEqual([
      { id: 'after', kind: 'comparison', title: 'Settings', parts: [before, after] },
      { id: 'phone', kind: 'screenshot', title: 'Settings', parts: [phone] },
    ]);
  });

  test('parts attached together share an item, and a later after at their title joins it', () => {
    const before = piece('before', { title: 'Tabs', stage: 'before', itemId: 'i1' });
    const loading = piece('loading', { title: 'Tabs', label: 'Loading', itemId: 'i1' });
    const later = piece('later', { title: 'Tabs', stage: 'after', kind: 'recording' });
    const elsewhere = piece('elsewhere', { title: 'Tabs', stage: 'after', round: 2 });
    expect(listEvidenceItems([before, loading, later, elsewhere])).toEqual([
      { id: 'i1', kind: 'comparison', title: 'Tabs', parts: [before, loading, later] },
      { id: 'elsewhere', kind: 'screenshot', title: 'Tabs', parts: [elsewhere] },
    ]);
  });

  test('a stage shot again pairs its latest shot, and the earlier one stays an item of its own', () => {
    const first = piece('first', { title: 'Home', stage: 'after' });
    const before = piece('before', { title: 'Home', stage: 'before' });
    const again = piece('again', { title: 'Home', stage: 'after' });
    expect(listEvidenceItems([first, before, again])).toEqual([
      { id: 'first', kind: 'screenshot', title: 'Home', parts: [first] },
      { id: 'before', kind: 'comparison', title: 'Home', parts: [before, again] },
    ]);
  });

  test('every other piece is an item of its own kind, in the order attached', () => {
    const run = piece('test', { kind: 'test', title: 'Tests', uri: '/e/t.txt' });
    const twin = piece('twin', { kind: 'test', title: 'Tests', uri: '/e/u.txt', stage: 'after' });
    const shot = piece('shot');
    expect(listEvidenceItems([run, twin, shot]).map((item) => [item.id, item.kind])).toEqual([
      ['test', 'test'],
      ['twin', 'test'],
      ['shot', 'screenshot'],
    ]);
  });
});
