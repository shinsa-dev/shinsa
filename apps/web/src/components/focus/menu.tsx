import type { ShinsaState } from '@shinsa/core';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@shinsa/ui/components/dropdown-menu';
import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import { ProjectDot, ProjectDotIcon } from '@/components/status/project-dot.tsx';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { resolveFocusUntil, selectFocus } from '@/lib/focus.ts';
import { listProjects } from '@/lib/projects.ts';
import { resolveSettingsPath } from '@/lib/settings-tabs.ts';
import { navigate } from '@/router.ts';

const ALL_WORK = 'all';

export function FocusMenu({ state, compact = false }: { state: ShinsaState; compact?: boolean }) {
  const projects = listProjects(state);
  const focus = selectFocus(state);

  function changeFocus(projectId: string | null, until: number | null) {
    void sendCommandWithToast({ type: 'focus.change', projectId, until });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type='button'
            className={cn(
              'corner-superellipse/1.125 flex cursor-pointer items-center text-left text-fg-3 text-xs outline-none hover:bg-bg-a2 hover:text-fg-4 active:bg-bg-a2 active:text-fg-4 data-popup-open:bg-bg-a2',
              compact
                ? 'h-6 gap-1 rounded-control-sm ps-1 pe-1.5'
                : 'h-7 w-full gap-2 rounded-control ps-1.5 pe-2.5'
            )}
          />
        }
      >
        <span className={cn('grid shrink-0 place-items-center', compact ? 'size-4' : 'size-5')}>
          <ProjectDot color={focus ? focus.color : 'gray'} />
        </span>
        <span className='text-fg-2'>Focus</span>
        <span className={cn('truncate text-fg-4', !compact && 'flex-1')}>
          {focus ? focus.name : 'All work'}
        </span>
        <Icon name='IconChevronDownSmall' size={compact ? 'sm' : 'md'} className='text-fg-4' />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={compact ? 'end' : 'start'} className='min-w-52'>
        <DropdownMenuRadioGroup
          value={focus?.id ?? ALL_WORK}
          onValueChange={(value) => changeFocus(value === ALL_WORK ? null : String(value), null)}
        >
          <DropdownMenuLabel>Focus on</DropdownMenuLabel>
          <DropdownMenuRadioItem value={ALL_WORK}>
            <ProjectDotIcon color='gray' />
            All work
          </DropdownMenuRadioItem>
          {projects.map((project) => (
            <DropdownMenuRadioItem key={project.id} value={project.id}>
              <ProjectDotIcon color={project.color} />
              {project.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {focus && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Keep {focus.name} in focus</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => changeFocus(focus.id, resolveFocusUntil('hours'))}>
                For 2 hours
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => changeFocus(focus.id, resolveFocusUntil('tonight'))}>
                Until tonight
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => changeFocus(focus.id, null)}>
                Until I change it
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate(resolveSettingsPath('projects'))}>
          {projects.length === 0 ? 'Create a project…' : 'Edit projects…'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
