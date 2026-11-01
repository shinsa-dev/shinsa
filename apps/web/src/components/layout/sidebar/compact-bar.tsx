import type { ShinsaState } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { CommandMenuButton } from '@/components/command/menu.tsx';
import { FeedbackButton } from '@/components/feedback/button.tsx';
import { HomeLink } from '@/components/layout/home-link.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { requestNewTaskOnHome } from '@/lib/command/menu.ts';

export function CompactBar({ state, onMenu }: { state: ShinsaState; onMenu: () => void }) {
  return (
    <header
      data-window-drag
      className='flex h-11 shrink-0 select-none items-center gap-2 border-border border-b px-2 desktop:ps-20 md:hidden'
    >
      <Hint label='Open the queue'>
        <Button
          variant='secondary'
          size='icon-sm'
          icon='IconSidebar'
          aria-label='Open the queue'
          onClick={onMenu}
        />
      </Hint>
      <HomeLink />
      <span className='flex-1' />
      <FeedbackButton state={state} />
      <CommandMenuButton />
      <Hint label='New task'>
        <Button
          variant='secondary'
          size='icon-sm'
          icon='IconPlusMedium'
          aria-label='New task'
          onClick={() => requestNewTaskOnHome()}
        />
      </Hint>
    </header>
  );
}
