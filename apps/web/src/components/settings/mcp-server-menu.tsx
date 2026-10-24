import type { McpServerSummary } from '@shinsa/core';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@shinsa/ui/components/dropdown-menu';
import { Icon, type IconName } from '@shinsa/ui/components/icon';
import { OptionsTrigger } from '@/components/controls/options-trigger.tsx';
import { SelectedMark } from '@/components/status/check-mark.tsx';
import type { ExtensionActions } from '@/lib/connection/extensions.ts';
import {
  describeScopeChanged,
  EXTENSION_LABEL,
  type ExtensionPlaces,
  parseScope,
  resolveServerMenu,
  SERVER_EDIT,
  type ServerDialogTarget,
  serializeScope,
} from '@/lib/extensions.ts';

interface MenuProps {
  server: McpServerSummary;
  places: ExtensionPlaces;
  actions: ExtensionActions;
}

function ScopeSubmenu({
  icon,
  label,
  empty,
  current,
  places,
  onPick,
}: {
  icon: IconName;
  label: string;
  empty: string;
  current: string;
  places: { value: string; name: string }[];
  onPick: (value: string) => void;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Icon name={icon} />
        {label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className='min-w-48'>
        {places.length === 0 && <DropdownMenuItem disabled>{empty}</DropdownMenuItem>}
        <DropdownMenuRadioGroup value={current} onValueChange={(value) => onPick(String(value))}>
          {places.map((place) => (
            <DropdownMenuRadioItem key={place.value} value={place.value} closeOnClick>
              {place.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function ScopeItems({ server, places, actions }: MenuProps) {
  const pick = (value: string) => {
    const scope = parseScope(value);
    void actions.choose(server, { scope }, describeScopeChanged(server.name, scope, places));
  };
  const current = serializeScope(server.scope);
  return (
    <>
      <DropdownMenuItem icon='IconGlobe' onClick={() => pick('everywhere')}>
        <span className='flex-1'>{EXTENSION_LABEL.useEverywhere}</span>
        {server.scope.kind === 'everywhere' && <SelectedMark />}
      </DropdownMenuItem>
      <ScopeSubmenu
        icon='IconLayersTwo'
        label={EXTENSION_LABEL.useInProject}
        empty={EXTENSION_LABEL.noProjects}
        current={current}
        places={places.projects.map((project) => ({
          value: serializeScope({ kind: 'project', project: project.id }),
          name: project.name,
        }))}
        onPick={pick}
      />
      <ScopeSubmenu
        icon='IconFolder1'
        label={EXTENSION_LABEL.useInRepo}
        empty={EXTENSION_LABEL.noRepos}
        current={current}
        places={places.repos.map((repo) => ({
          value: serializeScope({ kind: 'repo', path: repo.path }),
          name: repo.name,
        }))}
        onPick={pick}
      />
    </>
  );
}

export function ServerMenu({
  server,
  places,
  actions,
  detailsOpen,
  onToggleDetails,
  onOpen,
}: MenuProps & {
  detailsOpen: boolean;
  onToggleDetails: () => void;
  onOpen: (target: ServerDialogTarget) => void;
}) {
  const menu = resolveServerMenu(server);
  const edit = SERVER_EDIT[menu.edit];
  return (
    <DropdownMenu>
      <OptionsTrigger label={EXTENSION_LABEL.options} />
      <DropdownMenuContent align='end' className='min-w-56'>
        <DropdownMenuGroup>
          {menu.connect && (
            <DropdownMenuItem icon='IconUserKey' onClick={() => void actions.signIn(server)}>
              {menu.connect}
            </DropdownMenuItem>
          )}
          {menu.signOut && (
            <DropdownMenuItem icon='IconArrowBoxRight' onClick={() => void actions.signOut(server)}>
              {EXTENSION_LABEL.signOut}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem icon='IconArrowRotateClockwise' onClick={() => void actions.check(server)}>
            {EXTENSION_LABEL.checkNow}
          </DropdownMenuItem>
          <DropdownMenuItem icon='IconToolbox' onClick={onToggleDetails}>
            {detailsOpen ? EXTENSION_LABEL.hideDetails : EXTENSION_LABEL.details}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <ScopeItems server={server} places={places} actions={actions} />
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={edit.icon} onClick={() => onOpen({ mode: menu.edit, server })}>
          {edit.label}
        </DropdownMenuItem>
        {menu.remove && (
          <DropdownMenuItem
            icon='IconTrashCan'
            variant='destructive'
            onClick={() => onOpen({ mode: 'remove', server })}
          >
            {EXTENSION_LABEL.remove}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
