import type { RemoteTeam, RemoteUser, TeamPermission, TeamPermissionsChange } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shinsa/ui/components/dialog';
import { Switch } from '@shinsa/ui/components/switch';
import type { DialogControl } from '@shinsa/ui/hooks/use-dialog-state';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { SelectField } from '@/components/controls/select-field.tsx';
import { FoldingBlock, SETTING_ROW } from '@/components/settings/group.tsx';
import { requestWithToast } from '@/lib/connection/commands.ts';
import { createDisclosureId } from '@/lib/preferences/disclosure.ts';
import { resolveFirstName } from '@/lib/remote/users.ts';
import {
  createOverrideChange,
  describePermissionsOwner,
  describePermissionsSummary,
  listOverrideItems,
  PERMISSION_ROWS,
  PERMISSIONS_TITLE,
  resolveOverrideChoice,
} from '@/lib/teams/permissions.ts';

type UpdatePermissions = (
  teamId: string,
  userId: string | null,
  permissions: TeamPermissionsChange
) => Promise<unknown>;

function PermissionRow({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn(SETTING_ROW, 'py-1.5')}>
      <div className='flex min-w-0 flex-1 flex-col gap-px'>
        <span className='text-xs text-fg-4'>{title}</span>
        <span className='text-2xs text-pretty text-fg-2'>{hint}</span>
      </div>
      <div className='flex shrink-0 items-center'>{children}</div>
    </div>
  );
}

export function TeamPermissionsBlock({ team, onUpdate }: { team: RemoteTeam; onUpdate: UpdatePermissions }) {
  const note = describePermissionsOwner(team);
  const change = (name: TeamPermission, value: boolean) =>
    void requestWithToast(() => onUpdate(team.id, null, { [name]: value }));
  return (
    <FoldingBlock
      persistId={createDisclosureId('settings', 'teams', team.id, 'permissions')}
      title={PERMISSIONS_TITLE}
      detail={describePermissionsSummary(team.permissions)}
      startsOpen={team.role === 'owner'}
    >
      {PERMISSION_ROWS.map((row) => (
        <PermissionRow key={row.name} title={row.title} hint={row.hint}>
          <Switch
            checked={team.permissions[row.name]}
            disabled={note !== null}
            aria-label={row.title}
            onCheckedChange={(value) => change(row.name, value)}
          />
        </PermissionRow>
      ))}
      {note && <p className={cn(SETTING_ROW, 'text-2xs text-fg-2')}>{note}</p>}
    </FoldingBlock>
  );
}

export function MemberRightsDialog({
  control,
  team,
  user,
  onUpdate,
}: {
  control: DialogControl;
  team: RemoteTeam;
  user: RemoteUser;
  onUpdate: UpdatePermissions;
}) {
  const name = resolveFirstName(user);
  return (
    <Dialog {...control}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`What ${name} can do`}</DialogTitle>
          <DialogDescription>
            {`${name} follows the team’s settings unless you set a right apart for them here. It applies on every machine in ${team.name}.`}
          </DialogDescription>
        </DialogHeader>
        <div className='-mx-2 flex flex-col'>
          {PERMISSION_ROWS.map((row) => (
            <PermissionRow key={row.name} title={row.title} hint={row.hint}>
              <SelectField
                label={`${row.title} for ${name}`}
                items={listOverrideItems(team.permissions[row.name])}
                value={resolveOverrideChoice(team, user.id, row.name)}
                onValueChange={(choice) =>
                  void requestWithToast(() =>
                    onUpdate(team.id, user.id, createOverrideChange(row.name, choice))
                  )
                }
                className='w-40'
              />
            </PermissionRow>
          ))}
        </div>
        <DialogFooter>
          <DialogClose render={<Button />}>Done</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
