import type { ProgramId, VersionsSnapshot } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import { RefreshButton } from '@/components/accounts/refresh-button.tsx';
import { checkVersions, requestUpdate, useVersions } from '@/lib/connection/versions.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import {
  describeProgramRow,
  describeSdkRow,
  listVersionEntries,
  VERSIONS_LABEL,
  VERSIONS_SECTION,
  type VersionRow,
} from '@/lib/versions.ts';
import { SETTING_ROW, SettingsEmpty, SettingsGroup, TOKEN_TEXT } from './group.tsx';

export interface VersionActions {
  refresh: () => Promise<unknown>;
  update: (program: ProgramId) => Promise<unknown>;
}

const VERSION_ACTIONS: VersionActions = { refresh: checkVersions, update: requestUpdate };

function VersionLine({ row, onUpdate }: { row: VersionRow; onUpdate?: () => void }) {
  return (
    <div className={SETTING_ROW}>
      <div className='flex min-w-0 flex-1 flex-col'>
        <div className='flex min-w-0 items-center gap-1.5 text-xs'>
          <span className='shrink-0 text-fg-4'>{row.title}</span>
          {row.version && <span className={TOKEN_TEXT}>{row.version}</span>}
          {row.status && (
            <Truncate className={cn('min-w-0', TONE_TEXT[row.status.tone])}>{row.status.label}</Truncate>
          )}
        </div>
        <Truncate className='text-2xs text-fg-2'>{row.detail}</Truncate>
      </div>
      {onUpdate && (row.canUpdate || row.updating) && (
        <Button variant='secondary' size='sm' icon='IconArrowDown' loading={row.updating} onClick={onUpdate}>
          {VERSIONS_LABEL.update}
        </Button>
      )}
    </div>
  );
}

export function VersionsGroup({
  snapshot,
  failure,
  updating,
  actions,
}: {
  snapshot: VersionsSnapshot | null;
  failure: string | null;
  updating: ProgramId[];
  actions: VersionActions;
}) {
  return (
    <SettingsGroup
      title={VERSIONS_SECTION}
      action={<RefreshButton label={VERSIONS_LABEL.refresh} onRefresh={actions.refresh} />}
    >
      {!snapshot && <SettingsEmpty>{failure ?? VERSIONS_LABEL.checking}</SettingsEmpty>}
      {snapshot &&
        listVersionEntries(snapshot).map((entry) =>
          entry.kind === 'sdk' ? (
            <VersionLine key='sdk' row={describeSdkRow(entry.sdk)} />
          ) : (
            <VersionLine
              key={entry.program.id}
              row={describeProgramRow(entry.program, updating.includes(entry.program.id))}
              onUpdate={() => void actions.update(entry.program.id)}
            />
          )
        )}
    </SettingsGroup>
  );
}

export function VersionSettings() {
  const { snapshot, failure, updating } = useVersions();
  return (
    <VersionsGroup snapshot={snapshot} failure={failure} updating={updating} actions={VERSION_ACTIONS} />
  );
}
