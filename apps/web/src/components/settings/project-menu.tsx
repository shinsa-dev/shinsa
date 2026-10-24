import { PROJECT_COLORS, type Project, type ShinsaState } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@shinsa/ui/components/dropdown-menu';
import { Truncate } from '@shinsa/ui/components/truncate';
import { OptionsTrigger } from '@/components/controls/options-trigger.tsx';
import { SelectedMark } from '@/components/status/check-mark.tsx';
import { ProjectDotIcon } from '@/components/status/project-dot.tsx';
import { useMenuAnswer } from '@/hooks/use-menu-answer.ts';
import {
  listRepoChoiceGroups,
  type ProjectActions,
  type ProjectDialogMode,
  resolveProjectInput,
} from '@/lib/projects.ts';

export type ProjectDialogValue = ProjectDialogMode | 'remove';

export function AddMenu({
  state,
  project,
  actions,
  onAddFolder,
}: {
  state: ShinsaState;
  project: Project;
  actions: ProjectActions;
  onAddFolder: () => void;
}) {
  const { value, failure, ask } = useMenuAnswer(actions.listLocalRepos);
  const groups = value ? listRepoChoiceGroups(state, value, project.id) : null;
  return (
    <DropdownMenu onOpenChange={ask}>
      <DropdownMenuTrigger
        render={
          <Button variant='secondary' size='xs' icon='IconPlusSmall' aria-label={`Add to ${project.name}`}>
            Add
          </Button>
        }
      />
      <DropdownMenuContent align='end' className='max-h-80 min-w-64 max-w-96'>
        <DropdownMenuItem icon='IconFolder1' onClick={onAddFolder}>
          Folder by its path…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {failure && <DropdownMenuItem disabled>{failure}</DropdownMenuItem>}
        {!failure && !groups && <DropdownMenuItem disabled>Looking for repositories…</DropdownMenuItem>}
        {groups?.length === 0 && <DropdownMenuItem disabled>No other repositories found.</DropdownMenuItem>}
        {groups?.map((group) => (
          <DropdownMenuGroup key={group.title}>
            <DropdownMenuLabel>{group.title}</DropdownMenuLabel>
            {group.repos.map((repo) => (
              <DropdownMenuItem
                key={repo.path}
                icon='IconGithub'
                onClick={() => void actions.addRepo(project, repo.path)}
              >
                <span className='flex min-w-0 flex-1 items-baseline gap-1.5'>
                  <Truncate className='text-fg-4'>{repo.name}</Truncate>
                  <Truncate className='min-w-0 shrink-[4] text-2xs text-fg-2'>{repo.detail}</Truncate>
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ColourSubmenu({ project, actions }: { project: Project; actions: ProjectActions }) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <ProjectDotIcon color={project.color} />
        Colour
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className='min-w-36'>
        {PROJECT_COLORS.map((color) => (
          <DropdownMenuItem
            key={color}
            onClick={() => void actions.write(resolveProjectInput(project, { color }), 'Colour changed.')}
          >
            <ProjectDotIcon color={color} />
            <span className='flex-1 capitalize'>{color}</span>
            {project.color === color && <SelectedMark />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

export function ProjectMenu({
  project,
  actions,
  onShow,
}: {
  project: Project;
  actions: ProjectActions;
  onShow: (value: ProjectDialogValue) => void;
}) {
  return (
    <DropdownMenu>
      <OptionsTrigger label='Project options' />
      <DropdownMenuContent align='end' className='min-w-44'>
        <DropdownMenuGroup>
          <DropdownMenuItem icon='IconPencil' onClick={() => onShow('name')}>
            Rename…
          </DropdownMenuItem>
          <DropdownMenuItem icon='IconKey1' onClick={() => onShow('key')}>
            Change key…
          </DropdownMenuItem>
          <DropdownMenuItem icon='IconTextEdit' onClick={() => onShow('description')}>
            {project.description ? 'Edit description…' : 'Add description…'}
          </DropdownMenuItem>
          <ColourSubmenu project={project} actions={actions} />
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon='IconTrashCan' variant='destructive' onClick={() => onShow('remove')}>
          Remove project
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
