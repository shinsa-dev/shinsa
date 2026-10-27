import { describe, expect, it } from 'bun:test';
import { attachSlot, detachSlot, SlotRegistry } from '@/lib/code/editor/slots.ts';

describe('SlotRegistry', () => {
  it('keeps one element per note for React to render into, whether or not the editor shows it', () => {
    const registry = new SlotRegistry();
    expect(registry.select('note:1')).toBeNull();
    const element = registry.upsert('note:1');
    expect(element.className).toBe('cm-note-slot');
    expect(element.dataset.slot).toBe('note:1');
    expect(registry.upsert('note:1')).toBe(element);
    expect(registry.select('note:1')).toBe(element);
    registry.upsert('note:2');
    expect(registry.list()).toHaveLength(2);
    registry.recordHeight('note:1', 0);
    expect(registry.readHeight('note:1')).toBe(-1);
    registry.recordHeight('note:1', 120);
    expect(registry.readHeight('note:1')).toBe(120);
    const holder = document.createElement('div');
    holder.appendChild(element);
    registry.retain(new Set(['note:2']));
    expect(element.parentElement).toBeNull();
    expect(registry.select('note:1')).toBeNull();
    expect(registry.readHeight('note:1')).toBe(-1);
    expect(registry.list()).toHaveLength(1);
  });
});

describe('attachSlot and detachSlot', () => {
  it('moves the note’s element into the block the editor draws and takes it out again with its height', () => {
    const registry = new SlotRegistry();
    const block = attachSlot('note:1', registry);
    const slot = registry.select('note:1');
    expect(block.className).toBe('cm-note-block');
    expect(slot?.parentElement).toBe(block);
    const later = attachSlot('note:1', registry);
    expect(slot?.parentElement).toBe(later);
    detachSlot('note:1', registry, block);
    expect(slot?.parentElement).toBe(later);
    Object.defineProperty(slot, 'offsetHeight', { value: 64 });
    detachSlot('note:1', registry, later);
    expect(slot?.parentElement).toBeNull();
    expect(registry.readHeight('note:1')).toBe(64);
    detachSlot('gone', registry, later);
  });
});
