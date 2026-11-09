import type { Initiative, ShinsaState } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@shinsa/ui/components/dropdown-menu';
import { EmptyState } from '@shinsa/ui/components/empty-state';
import { Icon } from '@shinsa/ui/components/icon';
import { useDialogState } from '@shinsa/ui/hooks/use-dialog-state';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { OptionsTrigger } from '@/components/controls/options-trigger.tsx';
import { LeadPanel } from '@/components/initiatives/lead.tsx';
import { InitiativeSections, PhaseTrack } from '@/components/initiatives/sheet.tsx';
import { PAGE_BOTTOM, PAGE_COLUMN, PAGE_TOP } from '@/components/layout/page/column.ts';
import { PAGE_DESCRIPTION, PageHeading } from '@/components/layout/page/heading.tsx';
import { CARD } from '@/components/layout/surface/card.ts';
import { ConfirmDialog } from '@/components/overlays/confirm-dialog.tsx';
import { FACT } from '@/components/task/fact.ts';
import { useEngineCommand } from '@/lib/connection/socket.ts';
import { selectFocusInitiative } from '@/lib/focus.ts';
import { openInitiativeDialog } from '@/lib/initiatives/draft.ts';
import { focusInitiative, removeInitiative } from '@/lib/initiatives/membership.ts';
import {
  describeSheetSummary,
  INITIATIVE_ICON,
  INITIATIVES_DESCRIPTION,
  INITIATIVES_TITLE,
  listInitiativeRows,
  resolveCanonicalInitiativePath,
  selectInitiativeView,
} from '@/lib/initiatives/view.ts';
import { navigate, replaceRoute, resolveInitiativePath, useSearchString } from '@/router.ts';

function NewInitiativeButton() {
  const writable = useEngineCommand('initiative.write');
  if (!writable) return null;
  return (
    <Button variant='secondary' size='sm' icon='IconPlusMedium' onClick={() => openInitiativeDialog()}>
      New initiative
    </Button>
  );
}

export function InitiativesPage({ state }: { state: ShinsaState }) {
  const rows = listInitiativeRows(state);
  return (
    <div className={cn(PAGE_COLUMN, PAGE_TOP, PAGE_BOTTOM, 'flex flex-col gap-6')}>
      <div className='flex items-end gap-3'>
        <PageHeading
          title={INITIATIVES_TITLE}
          description={<p className={PAGE_DESCRIPTION}>{INITIATIVES_DESCRIPTION}</p>}
          className='flex-1'
        />
        <NewInitiativeButton />
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={INITIATIVE_ICON}
          title='No initiatives yet'
          description='Make one from a task’s menu, or create one here and add tasks to it.'
        />
      ) : (
        <ul className={cn(CARD, 'flex flex-col overflow-hidden')}>
          {rows.map((row) => (
            <li key={row.initiative.id} className='border-b border-border last:border-b-0'>
              <button
                type='button'
                className='flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left outline-none hover:bg-bg-a1 active:bg-bg-a1'
                onClick={() => navigate(resolveInitiativePath(row.initiative.id))}
              >
                <Icon name={INITIATIVE_ICON} className='shrink-0 text-fg-3' />
                <span className='flex min-w-0 flex-1 flex-col'>
                  <span className='truncate text-sm font-medium text-fg-4'>{row.initiative.name}</span>
                  {row.initiative.description && (
                    <span className='truncate text-xs text-fg-2'>{row.initiative.description}</span>
                  )}
                </span>
                <span className='shrink-0 text-xs text-fg-2 tabular-nums'>{row.summary}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function InitiativeMenu({ state, initiative }: { state: ShinsaState; initiative: Initiative }) {
  const confirm = useDialogState<Initiative>();
  const writable = useEngineCommand('initiative.write');
  const removable = useEngineCommand('initiative.remove');
  const focused = selectFocusInitiative(state)?.id === initiative.id;
  return (
    <>
      <DropdownMenu>
        <OptionsTrigger label='Initiative actions' />
        <DropdownMenuContent align='end' className='min-w-48'>
          {writable && (
            <DropdownMenuItem icon='IconPencil' onClick={() => openInitiativeDialog(initiative.id)}>
              Edit initiative
            </DropdownMenuItem>
          )}
          {!focused && (
            <DropdownMenuItem icon={INITIATIVE_ICON} onClick={() => void focusInitiative(initiative)}>
              Focus on this initiative
            </DropdownMenuItem>
          )}
          {removable && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                icon='IconTrashCan'
                variant='destructive'
                onClick={() => confirm.show(initiative)}
              >
                Remove initiative
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {confirm.value && (
        <ConfirmDialog
          control={confirm.control}
          title={`Remove “${confirm.value.name}”?`}
          body='Its tasks stay as they are and leave the initiative.'
          action='Remove initiative'
          onConfirm={() => void removeInitiative(initiative)}
        />
      )}
    </>
  );
}

export function InitiativePage({ state, reference }: { state: ShinsaState; reference: string }) {
  const sheet = selectInitiativeView(state, reference, Date.now());
  const query = useSearchString();
  const canonical = sheet ? resolveCanonicalInitiativePath(sheet.initiative, reference, query) : null;
  React.useEffect(() => {
    if (canonical) replaceRoute(canonical);
  }, [canonical]);
  if (!sheet) {
    return (
      <EmptyState icon={INITIATIVE_ICON} title='No such initiative' description='It may have been removed.' />
    );
  }
  const { initiative } = sheet;
  return (
    <div className={cn(PAGE_COLUMN, PAGE_TOP, PAGE_BOTTOM, 'flex flex-col gap-4')}>
      <div className='flex flex-col gap-2.5'>
        <PageHeading
          title={initiative.name}
          description={
            initiative.description ? (
              <p className={cn(PAGE_DESCRIPTION, 'selectable whitespace-pre-line')}>
                {initiative.description}
              </p>
            ) : undefined
          }
          className='py-0.5'
        />
        <div className='flex items-start gap-2'>
          <div className='-ms-1.5 flex min-w-0 flex-1 flex-wrap items-center gap-1'>
            <span className={FACT}>
              <Icon size='sm' name={INITIATIVE_ICON} />
              <span className='truncate tabular-nums'>{describeSheetSummary(sheet)}</span>
            </span>
          </div>
          <div className='flex h-6 shrink-0 items-center'>
            <InitiativeMenu state={state} initiative={initiative} />
          </div>
        </div>
      </div>
      <LeadPanel state={state} initiative={initiative} />
      <PhaseTrack sheet={sheet} />
      <InitiativeSections state={state} sheet={sheet} />
    </div>
  );
}
