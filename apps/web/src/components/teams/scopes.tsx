import {
  ACTION_SCOPES,
  type AccessScopes,
  type ActionScope,
  hasScope,
  type RemoteTeam,
  type RemoteUser,
  toggleScope,
} from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Checkbox } from '@shinsa/ui/components/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shinsa/ui/components/dialog';
import type { DialogControl } from '@shinsa/ui/hooks/use-dialog-state';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { SelectField } from '@/components/controls/select-field.tsx';
import { FoldingBlock, SETTING_ROW } from '@/components/settings/group.tsx';
import { requestWithToast } from '@/lib/connection/commands.ts';
import { createDisclosureId } from '@/lib/preferences/disclosure.ts';
import { resolveFirstName } from '@/lib/remote/users.ts';
import {
  describeExtraHint,
  describeScopesOwner,
  describeScopesSummary,
  listExtraRows,
  listMemberItems,
  listPresetItems,
  type MemberScopeChoice,
  PRESET_LABELS,
  resolveChoiceScopes,
  resolveMemberChoice,
  resolveMemberScopes,
  resolveTeamChoice,
  SCOPE_ROWS,
  SCOPES_TITLE,
  type TeamScopeChoice,
} from '@/lib/teams/scopes.ts';

type UpdateScopes = (teamId: string, userId: string | null, scopes: AccessScopes | null) => Promise<unknown>;

function ScopeCheck({
  scope,
  checked,
  disabled,
  label,
  onToggle,
}: {
  scope: ActionScope;
  checked: boolean;
  disabled: boolean;
  label: string;
  onToggle: (scope: ActionScope, on: boolean) => void;
}) {
  const id = React.useId();
  const row = SCOPE_ROWS[scope];
  return (
    <div className='flex min-w-0 items-start gap-2'>
      <Checkbox
        id={id}
        size='sm'
        className='mt-px'
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onCheckedChange={(next) => onToggle(scope, next)}
      />
      <label htmlFor={id} className='flex min-w-0 flex-col gap-px'>
        <span className='text-xs text-fg-4'>{row.title}</span>
        <span className='text-2xs text-pretty text-fg-2'>{row.hint}</span>
      </label>
    </div>
  );
}

function ScopeGrid({
  scopes,
  disabled,
  label,
  onToggle,
}: {
  scopes: AccessScopes;
  disabled: boolean;
  label: (title: string) => string;
  onToggle: (scope: ActionScope, on: boolean) => void;
}) {
  return (
    <div className='grid grid-cols-1 gap-x-4 gap-y-2 px-3 py-2 sm:grid-cols-2'>
      {ACTION_SCOPES.map((scope) => (
        <ScopeCheck
          key={scope}
          scope={scope}
          checked={hasScope(scopes, scope)}
          disabled={disabled}
          label={label(SCOPE_ROWS[scope].title)}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}

function PresetRow({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className={cn(SETTING_ROW, 'py-1.5')}>
      <div className='flex min-w-0 flex-1 flex-col gap-px'>
        <span className='text-xs text-fg-4'>{label}</span>
        <span className='text-2xs text-pretty text-fg-2'>{hint}</span>
      </div>
      <div className='flex shrink-0 items-center'>{children}</div>
    </div>
  );
}

export function TeamScopesBlock({ team, onUpdate }: { team: RemoteTeam; onUpdate: UpdateScopes | null }) {
  const note = describeScopesOwner(team, onUpdate !== null);
  const choice = resolveTeamChoice(team.scopes);
  const update = (scopes: AccessScopes) => {
    if (onUpdate && note === null) void requestWithToast(() => onUpdate(team.id, null, scopes));
  };
  return (
    <FoldingBlock
      persistId={createDisclosureId('settings', 'teams', team.id, 'scopes')}
      title={SCOPES_TITLE}
      detail={describeScopesSummary(team.scopes)}
    >
      <PresetRow label='Preset' hint={PRESET_LABELS[choice].hint}>
        {note === null ? (
          <SelectField
            label='Preset for the team'
            items={listPresetItems(choice)}
            value={choice}
            onValueChange={(next: TeamScopeChoice) => {
              const scopes = resolveChoiceScopes(next, team.scopes);
              if (scopes) update(scopes);
            }}
            className='w-40'
          />
        ) : (
          <span className='pr-1.5 text-xs text-fg-4'>{PRESET_LABELS[choice].label}</span>
        )}
      </PresetRow>
      <ScopeGrid
        scopes={team.scopes}
        disabled={note !== null}
        label={(title) => title}
        onToggle={(scope, on) => update(toggleScope(team.scopes, scope, on))}
      />
      {note && <p className={cn(SETTING_ROW, 'text-2xs text-fg-2')}>{note}</p>}
    </FoldingBlock>
  );
}

export function MemberScopesDialog({
  control,
  team,
  user,
  onUpdate,
}: {
  control: DialogControl;
  team: RemoteTeam;
  user: RemoteUser;
  onUpdate: UpdateScopes;
}) {
  const name = resolveFirstName(user);
  const choice = resolveMemberChoice(team, user.id);
  const scopes = resolveMemberScopes(team, user.id);
  const update = (next: AccessScopes | null) => void requestWithToast(() => onUpdate(team.id, user.id, next));
  return (
    <Dialog {...control}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`What ${name} can do`}</DialogTitle>
          <DialogDescription>
            {`${name} follows the team unless you pick something else for them. It applies on every machine in ${team.name}.`}
          </DialogDescription>
        </DialogHeader>
        <div className='-mx-2 flex flex-col'>
          <PresetRow
            label='Preset'
            hint={choice === 'team' ? 'Follows the team.' : PRESET_LABELS[choice].hint}
          >
            <SelectField
              label={`Preset for ${name}`}
              items={listMemberItems(team, choice)}
              value={choice}
              onValueChange={(next: MemberScopeChoice) => update(resolveChoiceScopes(next, scopes))}
              className='w-44'
            />
          </PresetRow>
          <ScopeGrid
            scopes={scopes}
            disabled={false}
            label={(title) => `${title} for ${name}`}
            onToggle={(scope, on) => update(toggleScope(scopes, scope, on))}
          />
        </div>
        <DialogFooter>
          <DialogClose render={<Button />}>Done</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MachineExtraDialog({
  control,
  team,
  user,
  extra,
  machineName,
  onUpdate,
  onFullAccess,
}: {
  control: DialogControl;
  team: RemoteTeam;
  user: RemoteUser;
  extra: AccessScopes;
  machineName: string;
  onUpdate: (teamId: string, userId: string, scopes: AccessScopes) => Promise<unknown>;
  onFullAccess: () => void;
}) {
  const name = resolveFirstName(user);
  const rows = listExtraRows(team, extra, user.id);
  const update = (scope: ActionScope, on: boolean) =>
    void requestWithToast(() => onUpdate(team.id, user.id, toggleScope(extra, scope, on)));
  return (
    <Dialog {...control}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`What ${name} can do on ${machineName}`}</DialogTitle>
          <DialogDescription>
            {`Give ${name} more than ${team.name} gives, on ${machineName} only.`}
          </DialogDescription>
        </DialogHeader>
        <div className='-mx-2 grid grid-cols-1 gap-x-4 gap-y-2 px-3 py-2 sm:grid-cols-2'>
          {rows.map((row) => (
            <ExtraCheck key={row.scope} row={row} name={name} onToggle={update} />
          ))}
        </div>
        <DialogFooter>
          <Button variant='secondary' onClick={onFullAccess}>
            {`Give full access to ${machineName}`}
          </Button>
          <DialogClose render={<Button />}>Done</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExtraCheck({
  row,
  name,
  onToggle,
}: {
  row: ReturnType<typeof listExtraRows>[number];
  name: string;
  onToggle: (scope: ActionScope, on: boolean) => void;
}) {
  const id = React.useId();
  return (
    <div className='flex min-w-0 items-start gap-2'>
      <Checkbox
        id={id}
        size='sm'
        className='mt-px'
        checked={row.on}
        disabled={row.locked}
        aria-label={`${SCOPE_ROWS[row.scope].title} for ${name}`}
        onCheckedChange={(next) => onToggle(row.scope, next)}
      />
      <label htmlFor={id} className='flex min-w-0 flex-col gap-px'>
        <span className='text-xs text-fg-4'>{SCOPE_ROWS[row.scope].title}</span>
        <span className='text-2xs text-pretty text-fg-2'>{describeExtraHint(row)}</span>
      </label>
    </div>
  );
}
