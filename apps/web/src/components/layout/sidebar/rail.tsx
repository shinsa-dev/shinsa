import type { ShinsaState } from '@shinsa/core';
import { HoverHighlight } from '@shinsa/ui/components/highlight-list';
import { UsageMenu } from '@/components/accounts/usage-menu.tsx';
import { CommandMenuButton } from '@/components/command/menu.tsx';
import { FocusMenu } from '@/components/focus/menu.tsx';
import { HomeLink } from '@/components/layout/home-link.tsx';
import { NavItem } from '@/components/layout/nav-item.tsx';
import { TaskQueue } from '@/components/queue/queue.tsx';
import { ConnectionStatus } from '@/components/status/connection-status.tsx';
import { UpdateButton } from '@/components/status/update-button.tsx';
import { requestNewTaskOnHome } from '@/lib/command/menu.ts';
import { resolveTerminalEntry } from '@/lib/terminal/tabs.ts';
import { navigate, useRoute, useRouteTaskId } from '@/router.ts';

export function Rail({ state, onNavigate = () => {} }: { state: ShinsaState; onNavigate?: () => void }) {
  const route = useRoute();
  const activeTaskId = useRouteTaskId(state);

  function go(path: string) {
    navigate(path);
    onNavigate();
  }

  return (
    <nav className='flex h-full w-full select-none flex-col bg-sidebar [--glyph-ring:var(--color-sidebar)]'>
      <div data-window-drag className='flex h-11 shrink-0 items-center gap-2 desktop:ps-20 ps-3.5 pe-2'>
        <HomeLink onNavigate={onNavigate} />
        <ConnectionStatus />
        <span className='flex-1' />
        <UpdateButton />
        {route.name !== 'onboarding' && <UsageMenu state={state} />}
        <CommandMenuButton />
      </div>
      <div className='flex flex-col px-2 pb-2'>
        <HoverHighlight className='flex flex-col gap-px'>
          <NavItem
            label='New task'
            icon='IconPlusMedium'
            active={route.name === 'home'}
            onClick={() => {
              requestNewTaskOnHome();
              onNavigate();
            }}
          />
          <NavItem
            label='All tasks'
            icon='IconListBullets'
            activeIcon='IconListBulletsFilled'
            active={route.name === 'tasks'}
            onClick={() => go('/tasks')}
          />
          <NavItem
            label='Terminal'
            icon='IconConsole'
            active={route.name === 'terminal'}
            onClick={() => go(resolveTerminalEntry())}
          />
          <NavItem
            label='Settings'
            icon='IconSettingsGear1'
            activeIcon='IconSettingsGear1Filled'
            active={route.name === 'settings'}
            onClick={() => go('/settings')}
          />
        </HoverHighlight>
      </div>
      {route.name !== 'onboarding' && (
        <div className='flex flex-col border-border border-t px-2 py-2'>
          <FocusMenu state={state} />
        </div>
      )}
      <div className='flex min-h-0 flex-1 flex-col overflow-y-auto border-border border-t'>
        <TaskQueue state={state} variant='compact' activeTaskId={activeTaskId} onNavigate={onNavigate} />
      </div>
    </nav>
  );
}
