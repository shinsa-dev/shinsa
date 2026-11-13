import { type FocusProjects, NO_FOCUS_PROJECTS, type Project, type ShinsaState } from '@shinsa/core';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@shinsa/ui/components/dropdown-menu';
import { Icon, type IconName } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import { ProjectDot, ProjectOption } from '@/components/status/project-dot.tsx';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { useEngineFeature, useRemoteSnapshot } from '@/lib/connection/socket.ts';
import {
  resolveFocusLabel,
  type FocusTarget,
  listFocusTeams,
  resolveFocusTarget,
  resolveFocusUntil,
  resolveKeptUntil,
  selectFocus,
  selectFocusInitiative,
  selectFocusProjects,
  selectFocusTeam,
  toggleFocusProject,
  YOUR_WORK,
} from '@/lib/focus.ts';
import { listOpenInitiatives } from '@/lib/initiatives/membership.ts';
import { INITIATIVE_ICON, INITIATIVES_TITLE } from '@/lib/initiatives/view.ts';
import { listProjects } from '@/lib/projects.ts';
import { resolveSettingsPath } from '@/lib/settings-tabs.ts';
import { TEAMS_SECTION } from '@/lib/teams/settings.ts';
import { navigate } from '@/router.ts';

const YOUR_WORK_VALUE = 'all';

const TEAM_VALUE_PREFIX = 'team:';

const INITIATIVE_VALUE_PREFIX = 'initiative:';

export const TEAM_ICON = 'IconUserDuo';

export function ProjectMenuTrigger({
  color,
  prefix,
  value,
  compact = false,
  icon = null,
}: {
  color: string;
  prefix?: string;
  value: string;
  compact?: boolean;
  icon?: IconName | null;
}) {
  return (
    <DropdownMenuTrigger
      render={
        <button
          type='button'
          className={cn(
            'corner-superellipse/1.125 flex cursor-pointer items-center text-left text-xs text-fg-3 outline-none hover:bg-bg-a2 hover:text-fg-4 active:bg-bg-a2 active:text-fg-4 data-popup-open:bg-bg-a2',
            compact
              ? 'h-6 min-w-0 gap-1 rounded-control-sm ps-1 pe-1.5'
              : 'h-7 w-full gap-2 rounded-control ps-1.5 pe-2.5'
          )}
        />
      }
    >
      <span className={cn('grid shrink-0 place-items-center', compact ? 'size-4' : 'size-5')}>
        {icon ? <Icon size='sm' name={icon} className='text-fg-3' /> : <ProjectDot color={color} />}
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

function resolveRadioValue(projectId: string | null, teamId: string | null, initiativeId: string | null) {
  if (initiativeId) return `${INITIATIVE_VALUE_PREFIX}${initiativeId}`;
  if (teamId) return `${TEAM_VALUE_PREFIX}${teamId}`;
  return projectId ?? YOUR_WORK_VALUE;
}

function parseRadioValue(value: string): FocusTarget {
  if (value === YOUR_WORK_VALUE) return { projectId: null, teamId: null };
  if (value.startsWith(INITIATIVE_VALUE_PREFIX))
    return { projectId: null, teamId: null, initiativeId: value.slice(INITIATIVE_VALUE_PREFIX.length) };
  if (value.startsWith(TEAM_VALUE_PREFIX))
    return { projectId: null, teamId: value.slice(TEAM_VALUE_PREFIX.length) };
  return { projectId: value, teamId: null };
}

function changeFocus(target: FocusTarget, until: number | null) {
  void sendCommandWithToast({ type: 'focus.change', ...target, until });
}

function ProjectCheckboxItems({
  state,
  projects,
  selection,
  team,
}: {
  state: ShinsaState;
  projects: Project[];
  selection: FocusProjects;
  team: boolean;
}) {
  const nothing = selection.projectIds.length === 0 && !team;
  const until = team ? null : resolveKeptUntil(state);
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>Focus on</DropdownMenuLabel>
      <DropdownMenuCheckboxItem
        checked={nothing}
        onCheckedChange={() => changeFocus({ projectId: null, teamId: null }, null)}
      >
        <ProjectOption color='gray' name={YOUR_WORK} />
      </DropdownMenuCheckboxItem>
      {projects.map((project) => (
        <DropdownMenuCheckboxItem
          key={project.id}
          checked={!team && selection.projectIds.includes(project.id)}
          onCheckedChange={() => {
            const next = toggleFocusProject(team ? NO_FOCUS_PROJECTS : selection, project.id);
            changeFocus(resolveFocusTarget(next), next.projectIds.length > 0 ? until : null);
          }}
        >
          <ProjectOption color={project.color} name={project.name} />
        </DropdownMenuCheckboxItem>
      ))}
      {!team && selection.projectIds.length > 0 && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={selection.except}
            onCheckedChange={(except) => changeFocus(resolveFocusTarget({ ...selection, except }), until)}
          >
            Show all but these
          </DropdownMenuCheckboxItem>
        </>
      )}
    </DropdownMenuGroup>
  );
}

export function FocusMenu({ state, compact = false }: { state: ShinsaState; compact?: boolean }) {
  const projects = listProjects(state);
  const teams = listFocusTeams(useRemoteSnapshot());
  const multiple = useEngineFeature('focus.projects');
  const selection = selectFocusProjects(state);
  const single = selectFocus(state);
  const focusTeam = selectFocusTeam(state, teams);
  const initiatives = listOpenInitiatives(state);
  const showInitiatives = useEngineFeature('initiatives') && initiatives.length > 0;
  const focusInitiative = selectFocusInitiative(state);
  const label = focusInitiative?.name ?? focusTeam?.name ?? resolveFocusLabel(state, selection);
  const keptTarget: FocusTarget = focusInitiative
    ? { projectId: null, teamId: null, initiativeId: focusInitiative.id }
    : resolveFocusTarget(selection, focusTeam?.id ?? null);
  const radioValue = resolveRadioValue(
    single?.id ?? null,
    focusTeam?.id ?? null,
    focusInitiative?.id ?? null
  );
  const triggerIcon = focusInitiative ? INITIATIVE_ICON : focusTeam ? TEAM_ICON : null;

  return (
    <DropdownMenu>
      <ProjectMenuTrigger
        color={single ? single.color : 'gray'}
        prefix='Focus'
        value={label ?? YOUR_WORK}
        compact={compact}
        icon={triggerIcon}
      />
      <DropdownMenuContent align={compact ? 'end' : 'start'} className='min-w-52'>
        {multiple ? (
          <ProjectCheckboxItems
            state={state}
            projects={projects}
            selection={selection}
            team={focusTeam !== null || focusInitiative !== null}
          />
        ) : (
          <DropdownMenuRadioGroup
            value={radioValue}
            onValueChange={(value) => changeFocus(parseRadioValue(String(value)), null)}
          >
            <DropdownMenuLabel>Focus on</DropdownMenuLabel>
            <DropdownMenuRadioItem value={YOUR_WORK_VALUE}>
              <ProjectOption color='gray' name={YOUR_WORK} />
            </DropdownMenuRadioItem>
            <ProjectRadioItems projects={projects} />
          </DropdownMenuRadioGroup>
        )}
        {teams.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={radioValue}
              onValueChange={(value) => changeFocus(parseRadioValue(String(value)), null)}
            >
              <DropdownMenuLabel>Teams</DropdownMenuLabel>
              {teams.map((team) => (
                <DropdownMenuRadioItem key={team.id} value={`${TEAM_VALUE_PREFIX}${team.id}`}>
                  <span className='flex min-w-0 items-center gap-2'>
                    <Icon size='sm' name={TEAM_ICON} className='text-fg-3' />
                    <span className='truncate'>{team.name}</span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        )}
        {showInitiatives && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={radioValue}
              onValueChange={(value) => changeFocus(parseRadioValue(String(value)), null)}
            >
              <DropdownMenuLabel>{INITIATIVES_TITLE}</DropdownMenuLabel>
              {initiatives.map((initiative) => (
                <DropdownMenuRadioItem
                  key={initiative.id}
                  value={`${INITIATIVE_VALUE_PREFIX}${initiative.id}`}
                >
                  <span className='flex min-w-0 items-center gap-2'>
                    <Icon size='sm' name={INITIATIVE_ICON} className='text-fg-3' />
                    <span className='truncate'>{initiative.name}</span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        )}
        {label && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Keep {label} in focus</DropdownMenuLabel>
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
        <DropdownMenuItem onClick={() => navigate(resolveSettingsPath('general', TEAMS_SECTION))}>
          {teams.length === 0 ? 'Create or join a team…' : 'Edit teams…'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
