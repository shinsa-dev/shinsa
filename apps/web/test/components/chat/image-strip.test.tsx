import { describe, expect, it } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { render, screen } from '@testing-library/react';
import { ImageStrip } from '@/components/chat/image-strip.tsx';
import { findTooltipText } from '../../support/hover.ts';

describe('an image strip', () => {
  it('names each thumbnail the same in its tooltip as for a screen reader', async () => {
    render(
      <TooltipProvider>
        <ImageStrip
          images={[{ src: '/api/evidence/a.png', caption: 'Login screen' }, '/api/evidence/b.png']}
        />
      </TooltipProvider>
    );
    const captioned = screen.getByRole('button', { name: 'Open Login screen' });
    expect(await findTooltipText(captioned)).toBe('Open Login screen');
    expect(screen.getByRole('button', { name: 'Open b.png' })).toBeTruthy();
  });
});
