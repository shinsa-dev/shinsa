import type { OnboardingStatus } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@shinsa/ui/components/dropdown-menu';
import { Icon } from '@shinsa/ui/components/icon';
import { Input } from '@shinsa/ui/components/input';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { Hint } from '@/components/overlays/hint.tsx';
import { SelectedMark } from '@/components/status/check-mark.tsx';
import { useMenuAnswer } from '@/hooks/use-menu-answer.ts';
import {
  requestRootSuggestions,
  restartOnboarding,
  updateRoots,
  useOnboardingStatus,
} from '@/lib/connection/onboarding.ts';
import { listFolderRows, listFolderSuggestions } from '@/lib/onboarding.ts';
import {
  FOLDERS_TITLE,
  type RootsChange,
  resolveRootAdded,
  resolveRootRemoved,
  resolveRootToggled,
} from '@/lib/settings.ts';
import { PathRow, SETTING_ROW, SettingRow, SettingsEmpty, SettingsGroup } from './group.tsx';

function changeRoots(change: RootsChange) {
  return updateRoots(change.roots, change.done);
}

function FindFolders({ status }: { status: OnboardingStatus }) {
  const { value, failure, ask } = useMenuAnswer(requestRootSuggestions);
  const suggestions = value ? listFolderSuggestions(status, value.suggestions) : null;
  return (
    <DropdownMenu onOpenChange={ask}>
      <DropdownMenuTrigger
        render={
          <Button variant='secondary' size='sm' icon='IconMagnifyingGlass'>
            Find folders
          </Button>
        }
      />
      <DropdownMenuContent align='end' className='min-w-64'>
        <DropdownMenuGroup>
          <DropdownMenuLabel>Folders that hold repositories</DropdownMenuLabel>
          {failure && <DropdownMenuItem disabled>{failure}</DropdownMenuItem>}
          {!failure && !suggestions && <DropdownMenuItem disabled>Looking for folders…</DropdownMenuItem>}
          {suggestions?.length === 0 && <DropdownMenuItem disabled>No repositories found.</DropdownMenuItem>}
          {suggestions?.map((suggestion) => (
            <DropdownMenuItem
              key={suggestion.path}
              closeOnClick={false}
              onClick={() => void changeRoots(resolveRootToggled(status.roots.configured, suggestion.path))}
            >
              <Icon name='IconFolder1' />
              <span className='flex min-w-0 flex-1 items-baseline gap-1.5'>
                <Truncate className='text-fg-4'>{suggestion.label}</Truncate>
                <span className='shrink-0 text-2xs text-fg-2'>{suggestion.detail}</span>
              </span>
              {suggestion.chosen && <SelectedMark />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AddFolder({ configured }: { configured: string[] }) {
  const [path, setPath] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  async function add() {
    if (!path.trim() || busy) return;
    setBusy(true);
    if (await changeRoots(resolveRootAdded(configured, path))) setPath('');
    setBusy(false);
  }

  return (
    <form
      className={cn(SETTING_ROW, 'gap-1.5')}
      onSubmit={(event) => {
        event.preventDefault();
        void add();
      }}
    >
      <Input
        size='sm'
        value={path}
        placeholder='Add a folder by its path'
        aria-label='Add a folder by its path'
        onChange={(event) => setPath(event.target.value)}
      />
      <Button type='submit' size='sm' disabled={!path.trim()} loading={busy}>
        Add folder
      </Button>
    </form>
  );
}

export function FolderSettings() {
  const status = useOnboardingStatus();
  if (!status) return null;
  const rows = listFolderRows(status);
  const { configured } = status.roots;
  return (
    <SettingsGroup title={FOLDERS_TITLE} action={<FindFolders status={status} />}>
      {rows.length === 0 && (
        <SettingsEmpty>No folders chosen yet. Find folders or add one by its path.</SettingsEmpty>
      )}
      {rows.map((row) => (
        <PathRow
          key={row.path}
          icon='IconFolders'
          iconLabel='Folder'
          title={row.label}
          action={
            row.removable ? (
              <Hint label='Remove folder'>
                <Button
                  variant='secondary'
                  size='icon-sm'
                  icon='IconCrossSmall'
                  aria-label='Remove folder'
                  onClick={() => void changeRoots(resolveRootRemoved(configured, row.path))}
                />
              </Hint>
            ) : (
              <span className='shrink-0 text-2xs text-fg-2'>From SHINSA_ROOTS</span>
            )
          }
        />
      ))}
      <AddFolder configured={configured} />
    </SettingsGroup>
  );
}

export function SetupSettings() {
  return (
    <SettingsGroup title='Setup'>
      <SettingRow title='Setup questions'>
        <Button
          variant='secondary'
          size='sm'
          icon='IconArrowRotateClockwise'
          onClick={() => void restartOnboarding()}
        >
          Run setup again
        </Button>
      </SettingRow>
    </SettingsGroup>
  );
}
