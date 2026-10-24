import { Button } from '@shinsa/ui/components/button';
import { CommandMenuButton } from '@/components/command/menu.tsx';
import { BrandLink } from '@/components/layout/brand-link.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { requestNewTaskOnHome } from '@/lib/command/menu.ts';

export function CompactBar({ onMenu }: { onMenu: () => void }) {
  return (
    <header
      data-window-drag
      className='flex h-11 shrink-0 items-center gap-2 border-border border-b px-2 desktop:ps-20 md:hidden'
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
      <BrandLink />
      <span className='flex-1' />
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
