import { describe, expect, it } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { render, screen } from '@testing-library/react';
import { ResizeHandle } from '@/components/layout/sidebar/resize-handle.tsx';
import { findTooltipText } from '../../../support/hover.ts';

describe('the sidebar’s resize handle', () => {
  it('names itself in its tooltip as it does for a screen reader, then says how to reset', async () => {
    render(
      <TooltipProvider>
        <ResizeHandle onPointerDown={() => {}} onDoubleClick={() => {}} />
      </TooltipProvider>
    );
    const handle = screen.getByRole('button', { name: 'Resize the sidebar' });
    expect(await findTooltipText(handle)).toBe('Resize the sidebar · Double-click to reset');
  });
});
