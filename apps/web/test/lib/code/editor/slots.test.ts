import { describe, expect, it } from 'bun:test';
import { createSlotElement, SlotRegistry } from '@/lib/code/editor/slots.ts';

describe('SlotRegistry', () => {
  it('tells React which note slots the editor drew, and forgets one only by its own element', () => {
    const registry = new SlotRegistry();
    const seen: number[] = [];
    const stop = registry.subscribe(() => seen.push(registry.read().size));
    const element = createSlotElement('note:1', registry);
    expect(element.className).toBe('cm-note-slot');
    expect(element.dataset.slot).toBe('note:1');
    expect(registry.read().get('note:1')).toBe(element);
    registry.release('note:1', document.createElement('div'));
    expect(registry.read().size).toBe(1);
    registry.release('note:1', element);
    expect(registry.read().size).toBe(0);
    stop();
    createSlotElement('note:2', registry);
    expect(seen).toEqual([1, 0]);
  });
});
