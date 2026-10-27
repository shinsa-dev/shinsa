import { describe, expect, it } from 'bun:test';
import { fireEvent, render } from '@testing-library/react';
import { Tabs, TabsList, TabsTrigger } from '../../src/components/tabs';
import { INDICATOR_TRANSITION } from '../../src/hooks/use-animated-indicator';

function renderTabs(variant: 'default' | 'underline' | 'ghost') {
  return render(
    <Tabs defaultValue='changes'>
      <TabsList aria-label='Code view' variant={variant}>
        <TabsTrigger value='changes'>Changes</TabsTrigger>
        <TabsTrigger value='files'>Files</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

describe('Tabs', () => {
  it('slides one marked pill to the tab you pick, on the movement clock', () => {
    const view = renderTabs('default');
    const list = view.getByRole('tablist', { name: 'Code view' });
    const indicators = list.querySelectorAll('[data-slot=tab-indicator]');
    expect(indicators).toHaveLength(1);
    const pill = indicators[0] as HTMLElement;
    expect(pill.dataset.motion).toBe('move');
    expect(pill.style.transition).toBe(INDICATOR_TRANSITION);
    expect(INDICATOR_TRANSITION).toContain('transform 200ms');
    fireEvent.click(view.getByRole('tab', { name: 'Files' }));
    expect(view.getByRole('tab', { name: 'Files' }).getAttribute('aria-selected')).toBe('true');
    expect(pill.style.transition).toBe(INDICATOR_TRANSITION);
  });

  it('marks the underline for motion too, and gives ghost tabs no indicator', () => {
    const underline = renderTabs('underline');
    const line = underline.getByRole('tablist').querySelector('[data-slot=tab-indicator]') as HTMLElement;
    expect(line.dataset.motion).toBe('move');
    underline.unmount();
    const ghost = renderTabs('ghost');
    expect(ghost.getByRole('tablist').querySelector('[data-slot=tab-indicator]')).toBeNull();
  });
});
