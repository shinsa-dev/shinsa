import { describe, expect, it, mock } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render } from '@testing-library/react';
import { CopyLinkButton } from '@/components/controls/copy-button.tsx';
import { HintButton } from '@/components/controls/hint-button.tsx';
import { findTooltipText } from '../../support/hover.ts';

describe('HintButton', () => {
  it('names the icon button by its hint, at the size it is given, and passes the rest through', async () => {
    const onClick = mock(() => undefined);
    const view = render(
      <TooltipProvider>
        <HintButton
          label='Next match'
          icon='IconChevronDownMedium'
          size='icon-xs'
          aria-pressed
          onClick={onClick}
        />
      </TooltipProvider>
    );
    const button = view.getByRole('button', { name: 'Next match' });
    expect(button.className).toContain('size-5.5');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(await findTooltipText(button)).toBe('Next match');
    view.unmount();
  });
});

describe('CopyLinkButton', () => {
  it('takes the small size only when asked', () => {
    const view = render(
      <>
        <CopyLinkButton url='https://example.com/a' />
        <CopyLinkButton url='https://example.com/b' label='Copy hand-off link' size='sm' />
      </>
    );
    expect(view.getByRole('button', { name: 'Copy link' }).className).toContain('h-6.5');
    expect(view.getByRole('button', { name: 'Copy hand-off link' }).className).toContain('h-6 ');
    view.unmount();
  });
});
