import { describe, expect, it } from 'bun:test';
import { SpotHintRegistry } from '@/lib/code/editor/spot-hints.ts';

describe('SpotHintRegistry', () => {
  it('tells its listeners once per batch which marks are drawn, each with its own id', async () => {
    const registry = new SpotHintRegistry();
    let calls = 0;
    const stop = registry.subscribe(() => {
      calls += 1;
    });
    const first = document.createElement('div');
    const second = document.createElement('div');
    registry.add(first, 'Critical');
    registry.add(second, 'Context');
    expect(registry.read()).toEqual([]);
    await Promise.resolve();
    expect(calls).toBe(1);
    const [a, b] = registry.read();
    expect([a?.element, a?.label, b?.element, b?.label]).toEqual([first, 'Critical', second, 'Context']);
    expect(a?.id).not.toBe(b?.id);
    registry.remove(first);
    registry.remove(document.createElement('div'));
    await Promise.resolve();
    expect(calls).toBe(2);
    expect(registry.read().map((hint) => hint.label)).toEqual(['Context']);
    stop();
    registry.remove(second);
    await Promise.resolve();
    expect(calls).toBe(2);
    expect(registry.read()).toEqual([]);
  });
});
