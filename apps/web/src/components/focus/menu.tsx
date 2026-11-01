import type { Project, ShinsaState } from '@shinsa/core';
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
import { ProjectDot, ProjectOption } from '@/components/status/project-dot.tsx';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { useRemoteSnapshot } from '@/lib/connection/socket.ts';
import { listFocusTeams, resolveFocusUntil, selectFocus, selectFocusTeam, YOUR_WORK } from '@/lib/focus.ts';
import { listProjects } from '@/lib/projects.ts';
import { isRemoteBuild } from '@/lib/remote/mode.ts';
import { resolveSettingsPath } from '@/lib/settings-tabs.ts';
import { TEAMS_SECTION } from '@/lib/teams/settings.ts';
import { navigate } from '@/router.ts';

const YOUR_WORK_VALUE = 'all';

const TEAM_VALUE_PREFIX = 'team:';

export const TEAM_ICON = 'IconUserDuo';

export function ProjectMenuTrigger({
  color,
  prefix,
  value,
  compact = false,
  team = false,
}: {
  color: string;
  prefix?: string;
  value: string;
  compact?: boolean;
  team?: boolean;
}) {
  return (
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
        {team ? <Icon size='sm' name={TEAM_ICON} className='text-fg-3' /> : <ProjectDot color={color} />}
      </span>
      {prefix && <span className='text-fg-2'>{prefix}</span>}
      <span className={cn('truncate text-fg-4', !compact && 'flex-1')}>{value}</span>
      <Icon name='IconChevronDownSmall' size={compact ? 'sm' : 'md'} className='text-fg-4' />
    </DropdownMenuTrigger>
  );
}

export function ProjectRadioItems({
  projects,
  closeOnClick = false,
}: {
  projects: Project[];
  closeOnClick?: boolean;
}) {
  return projects.map((project) => (
    <DropdownMenuRadioItem key={project.id} value={project.id} closeOnClick={closeOnClick}>
      <ProjectOption color={project.color} name={project.name} />
    </DropdownMenuRadioItem>
  ));
}

function resolveRadioValue(projectId: string | null, teamId: string | null) {
  if (teamId) return `${TEAM_VALUE_PREFIX}${teamId}`;
  return projectId ?? YOUR_WORK_VALUE;
}

function parseRadioValue(value: string) {
  if (value === YOUR_WORK_VALUE) return { projectId: null, teamId: null };
  if (value.startsWith(TEAM_VALUE_PREFIX))
    return { projectId: null, teamId: value.slice(TEAM_VALUE_PREFIX.length) };
  return { projectId: value, teamId: null };
}

export function FocusMenu({ state, compact = false }: { state: ShinsaState; compact?: boolean }) {
  const projects = listProjects(state);
  const teams = listFocusTeams(useRemoteSnapshot());
  const focus = selectFocus(state);
  const focusTeam = selectFocusTeam(state, teams);
  const kept = focusTeam ?? focus;

  function changeFocus(target: { projectId: string | null; teamId: string | null }, until: number | null) {
    void sendCommandWithToast({ type: 'focus.change', ...target, until });
  }

  const keptTarget = { projectId: focus?.id ?? null, teamId: focusTeam?.id ?? null };

  return (
    <DropdownMenu>
      <ProjectMenuTrigger
        color={focus ? focus.color : 'gray'}
        prefix='Focus'
        value={kept ? kept.name : YOUR_WORK}
        compact={compact}
        team={focusTeam !== null}
      />
      <DropdownMenuContent align={compact ? 'end' : 'start'} className='min-w-52'>
        <DropdownMenuRadioGroup
          value={resolveRadioValue(focus?.id ?? null, focusTeam?.id ?? null)}
          onValueChange={(value) => changeFocus(parseRadioValue(String(value)), null)}
        >
          <DropdownMenuLabel>Focus on</DropdownMenuLabel>
          <DropdownMenuRadioItem value={YOUR_WORK_VALUE}>
            <ProjectOption color='gray' name={YOUR_WORK} />
          </DropdownMenuRadioItem>
          <ProjectRadioItems projects={projects} />
          {teams.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Teams</DropdownMenuLabel>
              {teams.map((team) => (
                <DropdownMenuRadioItem key={team.id} value={`${TEAM_VALUE_PREFIX}${team.id}`}>
                  <span className='flex min-w-0 items-center gap-2'>
                    <Icon size='sm' name={TEAM_ICON} className='text-fg-3' />
                    <span className='truncate'>{team.name}</span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </>
          )}
        </DropdownMenuRadioGroup>
        {kept && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Keep {kept.name} in focus</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => changeFocus(keptTarget, resolveFocusUntil('hours'))}>
                For 2 hours
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => changeFocus(keptTarget, resolveFocusUntil('tonight'))}>
                Until tonight
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => changeFocus(keptTarget, null)}>
                Until I change it
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate(resolveSettingsPath('projects'))}>
          {projects.length === 0 ? 'Create a project…' : 'Edit projects…'}
        </DropdownMenuItem>
        {!isRemoteBuild() && (
          <DropdownMenuItem onClick={() => navigate(resolveSettingsPath('general', TEAMS_SECTION))}>
            {teams.length === 0 ? 'Create or join a team…' : 'Edit teams…'}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
