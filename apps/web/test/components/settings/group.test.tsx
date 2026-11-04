import { describe, expect, it } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { render } from '@testing-library/react';
import { PathRow, SETTING_ROW, SETTING_ROW_WRAPS, SettingRow } from '@/components/settings/group.tsx';

describe('settings rows on a phone', () => {
  it('lets a labelled row put its control under the label instead of crushing the label', () => {
    const view = render(
      <SettingRow title='Play a sound'>
        <button type='button'>When Shinsa is in the background</button>
      </SettingRow>
    );
    const row = view.getByRole('button').parentElement?.parentElement;
    expect(row?.className).toContain('max-sm:flex-wrap');
    expect(view.getByText('Play a sound').className).toContain('max-sm:flex-[1_0_auto]');
    view.unmount();
  });

  it('wraps a path row’s controls as one group, and the path takes the room left', () => {
    const view = render(
      <TooltipProvider>
        <PathRow
          icon='IconGithub'
          iconLabel='GitHub repository'
          title='basket-app'
          path='/tmp/repos/basket/basket-app'
          action={
            <>
              <button type='button'>2 commands before review</button>
              <button type='button'>Auto coverage</button>
            </>
          }
        />
      </TooltipProvider>
    );
    const [first, second] = view.getAllByRole('button');
    const controls = first?.parentElement;
    expect(second?.parentElement).toBe(controls);
    expect(controls?.className).toContain('flex-wrap');
    expect(controls?.parentElement?.className).toContain('max-sm:flex-wrap');
    expect(view.getByText('/tmp/repos/basket/basket-app').className).toContain('max-sm:grow');
    view.unmount();
  });

  it('keeps a plain row, such as a field and its button, on one line', () => {
    expect(SETTING_ROW).not.toContain('flex-wrap');
    expect(SETTING_ROW_WRAPS).toBe('max-sm:flex-wrap max-sm:gap-y-1.5');
  });
});
