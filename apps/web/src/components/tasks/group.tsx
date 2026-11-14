import type { ShinsaState } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import * as React from 'react';
import { DisclosureHeader } from '@/components/layout/surface/disclosure-header.tsx';
import { useSectionWindows, WINDOW_ROWS_ATTRIBUTE } from '@/hooks/use-row-window.ts';
import type { RowWindow } from '@/lib/format/rows.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import { type DisclosureId, useDisclosure } from '@/lib/preferences/disclosure.ts';
import type { ChainEntry, TaskGroup } from '@/lib/tasks/groups.ts';
import { resolveTeamTaskPath, resolveTeamTaskTarget } from '@/lib/teams/feeds.ts';
import { TeamTaskListRow } from '../teams/tasks.tsx';
import { TASK_LIST_COLUMNS, TASK_LIST_ROW_HEIGHT, TaskListRow } from './row.tsx';

export interface TaskGroupListSection {
  key: string;
  persistId: DisclosureId;
  group: Pick<TaskGroup, 'title' | 'icon' | 'tone'>;
  entries: ChainEntry[];
  defaultOpen: boolean;
}

function TaskGroupRows({
  index,
  entries,
  range,
  state,
  columns,
}: {
  index: number;
  entries: ChainEntry[];
  range: RowWindow;
  state: ShinsaState;
  columns: string;
}) {
  const { start, end } = range;
  return (
    <div {...{ [WINDOW_ROWS_ATTRIBUTE]: index }} className='flex flex-col'>
      {start > 0 && <div aria-hidden style={{ height: start * TASK_LIST_ROW_HEIGHT }} />}
      {entries
        .slice(start, end)
        .map((entry) =>
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
        )}
      {end < entries.length && (
        <div aria-hidden style={{ height: (entries.length - end) * TASK_LIST_ROW_HEIGHT }} />
      )}
    </div>
  );
}

function TaskGroupSection({
  index,
  persistId,
  section,
  range,
  remeasure,
  state,
  columns,
}: {
  index: number;
  persistId: DisclosureId;
  section: TaskGroupListSection;
  range: RowWindow;
  remeasure: () => void;
  state: ShinsaState;
  columns: string;
}) {
  const { group, entries, defaultOpen } = section;
  const disclosure = useDisclosure(persistId, defaultOpen);
  const shown = disclosure.open && entries.length > 0;
  React.useLayoutEffect(() => {
    if (shown) remeasure();
  }, [shown, remeasure]);
  if (entries.length === 0) return null;
  return (
    <section className='flex flex-col'>
      <DisclosureHeader
        disclosure={disclosure}
        strip='block'
        chevron='glyph'
        className='sticky top-0 z-10 w-full gap-2 bg-bg-1 ps-3 text-2xs font-medium text-fg-3 after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-border hover:text-fg-4 active:text-fg-4'
      >
        <Icon size='sm' name={group.icon} className={TONE_TEXT[group.tone]} />
        {group.title}
        <span className='font-normal text-fg-2 tabular-nums'>{entries.length}</span>
      </DisclosureHeader>
      {shown && (
        <TaskGroupRows index={index} entries={entries} range={range} state={state} columns={columns} />
      )}
    </section>
  );
}

export function TaskGroupList({
  sections,
  state,
  columns = TASK_LIST_COLUMNS,
  className,
}: {
  sections: readonly TaskGroupListSection[];
  state: ShinsaState;
  columns?: string;
  className?: string;
}) {
  const list = React.useRef<HTMLDivElement>(null);
  const { windows, remeasure } = useSectionWindows(
    list,
    sections.map((section) => section.entries.length),
    TASK_LIST_ROW_HEIGHT
  );
  return (
    <div ref={list} className={className}>
      {sections.map((section, index) => (
        <TaskGroupSection
          key={section.key}
          index={index}
          persistId={section.persistId}
          section={section}
          range={windows[index] as RowWindow}
          remeasure={remeasure}
          state={state}
          columns={columns}
        />
      ))}
    </div>
  );
}
