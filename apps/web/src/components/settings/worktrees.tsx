import type { OnboardingStatus } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { Input } from '@shinsa/ui/components/input';
import { toast } from '@shinsa/ui/components/sonner';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { describeFailure } from '@/lib/connection/commands.ts';
import { updateWorktreesDir, useOnboardingStatus, useWorktreeUsage } from '@/lib/connection/onboarding.ts';
import { useEngineFeature } from '@/lib/connection/socket.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import {
  describeFreeSpace,
  describeWorktreesSaved,
  describeWorktreeUsage,
  resolveWorktreeFolder,
  WORKTREE_CLEANUP_NOTE,
} from '@/lib/onboarding.ts';
import { WORKTREES_TITLE } from '@/lib/settings.ts';
import { PathRow, SETTING_ROW, SettingsGroup } from './group.tsx';

const WORKTREES_DESCRIPTION =
  'New tasks get their worktree in this folder, which can be on a drive you mount, such as an S3 or R2 bucket. Tasks that already have one keep it where it is.';

async function saveWorktreesDir(path: string | null) {
  try {
    const status = await updateWorktreesDir(path);
    toast.success(describeWorktreesSaved(status));
  } catch (error) {
    return describeFailure(error);
  }
  return null;
}

function UseDefault({ onFailure }: { onFailure: (failure: string | null) => void }) {
  const [busy, setBusy] = React.useState(false);

  async function reset() {
    setBusy(true);
    onFailure(await saveWorktreesDir(null));
    setBusy(false);
  }

  return (
    <Button variant='secondary' size='sm' loading={busy} onClick={() => void reset()}>
      Use default
    </Button>
  );
}

function ChooseFolder({
  failure,
  onFailure,
}: {
  failure: string | null;
  onFailure: (failure: string | null) => void;
}) {
  const [path, setPath] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  async function choose() {
    if (!path.trim() || busy) return;
    setBusy(true);
    const refused = await saveWorktreesDir(path.trim());
    onFailure(refused);
    if (!refused) setPath('');
    setBusy(false);
  }

  return (
    <div className='flex flex-col'>
      <form
        className={cn(SETTING_ROW, 'gap-1.5')}
        onSubmit={(event) => {
          event.preventDefault();
          void choose();
        }}
      >
        <Input
          size='sm'
          value={path}
          placeholder='Choose a folder by its path'
          aria-label='Choose a folder by its path'
          aria-invalid={failure ? true : undefined}
          onChange={(event) => {
            setPath(event.target.value);
            onFailure(null);
          }}
        />
        <Button type='submit' size='sm' disabled={!path.trim()} loading={busy}>
          Use folder
        </Button>
      </form>
      {failure && (
        <p role='alert' className='px-2 pb-1.5 text-2xs text-destructive'>
          {failure}
        </p>
      )}
    </div>
  );
}

function FolderAction({
  status,
  onFailure,
}: {
  status: OnboardingStatus;
  onFailure: (failure: string | null) => void;
}) {
  const folder = resolveWorktreeFolder(status);
  if (folder.origin === 'environment') {
    return <span className='shrink-0 text-2xs text-fg-2'>From SHINSA_WORKTREES_DIR</span>;
  }
  if (folder.origin === 'chosen') return <UseDefault onFailure={onFailure} />;
  return <span className='shrink-0 text-2xs text-fg-2'>Default</span>;
}

function StorageRow({ folder }: { folder: string }) {
  const usage = useWorktreeUsage(folder);
  const free = describeFreeSpace(usage);
  return (
    <div className={cn(SETTING_ROW, 'items-start gap-2 py-2 text-xs')}>
      <Icon size='sm' name='IconStorage' className='mt-0.5 shrink-0 text-fg-2' />
      <div className='flex min-w-0 flex-1 flex-col'>
        <span className='text-fg-4'>{describeWorktreeUsage(usage)}</span>
        <span className='text-2xs text-fg-2'>{WORKTREE_CLEANUP_NOTE}</span>
      </div>
      {free && <span className='shrink-0 text-2xs text-fg-2 tabular-nums'>{free}</span>}
    </div>
  );
}

export function WorktreeSettings() {
  const status = useOnboardingStatus();
  const supported = useEngineFeature('worktree-root');
  const [failure, setFailure] = React.useState<string | null>(null);
  if (!status || !supported) return null;
  const folder = resolveWorktreeFolder(status);
  return (
    <SettingsGroup title={WORKTREES_TITLE} description={WORKTREES_DESCRIPTION}>
      <PathRow
        icon='IconFolder1'
        iconLabel='Worktree folder'
        title={folder.label}
        action={<FolderAction status={status} onFailure={setFailure} />}
      />
      {folder.problem && (
        <div role='alert' className={cn(SETTING_ROW, 'gap-2 text-xs', TONE_TEXT.orange)}>
          <Icon size='sm' name='IconExclamationTriangle' />
          <span className='min-w-0 flex-1'>{folder.problem}</span>
        </div>
      )}
      <StorageRow folder={status.worktrees.effective} />
      {folder.origin !== 'environment' && <ChooseFolder failure={failure} onFailure={setFailure} />}
    </SettingsGroup>
  );
}
