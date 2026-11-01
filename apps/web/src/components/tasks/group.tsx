import type { ShinsaState } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { DisclosureHeader } from '@/components/layout/surface/disclosure-header.tsx';
import { WindowedRows } from '@/components/queue/windowed-rows.tsx';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import { type DisclosureId, useDisclosure } from '@/lib/preferences/disclosure.ts';
import type { ChainEntry, TaskGroup } from '@/lib/tasks/groups.ts';
import { resolveTeamTaskPath, resolveTeamTaskTarget } from '@/lib/teams/feeds.ts';
import { TeamTaskListRow } from '../teams/tasks.tsx';
import { TASK_LIST_COLUMNS, TASK_LIST_ROW_HEIGHT, TaskListRow } from './row.tsx';

export function TaskGroupSection({
  persistId,
  group,
  entries,
  state,
  defaultOpen,
  columns = TASK_LIST_COLUMNS,
}: {
  persistId: DisclosureId;
  group: TaskGroup;
  entries: ChainEntry[];
  state: ShinsaState;
  defaultOpen: boolean;
  columns?: string;
}) {
  const disclosure = useDisclosure(persistId, defaultOpen);
  if (entries.length === 0) return null;
  return (
    <section className='flex flex-col'>
      <DisclosureHeader
        disclosure={disclosure}
        strip='block'
        chevron='glyph'
        className='sticky top-0 z-10 w-full gap-2 bg-bg-1 ps-3 font-medium text-2xs text-fg-3 after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-border hover:text-fg-4 active:text-fg-4'
      >
        <Icon size='sm' name={group.icon} className={TONE_TEXT[group.tone]} />
        {group.title}
        <span className='font-normal text-fg-2 tabular-nums'>{entries.length}</span>
      </DisclosureHeader>
      {disclosure.open && (
        <WindowedRows items={entries} rowHeight={TASK_LIST_ROW_HEIGHT}>
          {(entry) =>
            entry.team ? (
              <TeamTaskListRow
                key={resolveTeamTaskPath(resolveTeamTaskTarget(entry.team.entry))}
                team={entry.team}
              />
            ) : (
              <TaskListRow
                key={entry.task.id}
                state={state}
                task={entry.task}
                depth={entry.depth}
                columns={columns}
              />
            )
          }
        </WindowedRows>
      )}
    </section>
  );
}
