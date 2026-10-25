import type { ShinsaState } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import * as React from 'react';
import { DisclosureHeader } from '@/components/layout/surface/disclosure-header.tsx';
import { WindowedRows } from '@/components/queue/windowed-rows.tsx';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import type { ChainEntry, RoadmapGroup } from '@/lib/tasks/roadmap.ts';
import { ROADMAP_ROW_HEIGHT, RoadmapRow } from './row.tsx';

export function RoadmapSection({
  group,
  entries,
  state,
  defaultOpen,
}: {
  group: RoadmapGroup;
  entries: ChainEntry[];
  state: ShinsaState;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  if (entries.length === 0) return null;
  return (
    <section className='flex flex-col'>
      <DisclosureHeader
        open={open}
        onToggle={() => setOpen(!open)}
        strip='block'
        chevron='glyph'
        className='sticky top-0 z-10 w-full gap-2 bg-bg-1 ps-3 font-medium text-2xs text-fg-3 after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-border hover:text-fg-4 active:text-fg-4'
      >
        <Icon size='sm' name={group.icon} className={TONE_TEXT[group.tone]} />
        {group.title}
        <span className='font-normal text-fg-2 tabular-nums'>{entries.length}</span>
      </DisclosureHeader>
      {open && (
        <WindowedRows items={entries} rowHeight={ROADMAP_ROW_HEIGHT}>
          {(entry) => (
            <RoadmapRow
              key={entry.task.id}
              state={state}
              task={entry.task}
              group={group.key}
              depth={entry.depth}
            />
          )}
        </WindowedRows>
      )}
    </section>
  );
}
