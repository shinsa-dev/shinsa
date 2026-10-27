import type { Run } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { ExpandRow } from '@/components/chat/chat-line.tsx';
import { ToolGroup } from '@/components/chat/tool-group.tsx';
import { IconSlot } from '@/components/layout/surface/icon-slot.tsx';
import { Markdown } from '@/components/text/markdown.tsx';
import { useProgressiveCount } from '@/hooks/use-progressive-count.ts';
import type { WorkItem } from '@/lib/chat/timeline.ts';
import { formatBrief } from '@/lib/chat/turns.ts';
import { useDisclosureScope } from '@/lib/preferences/disclosure.ts';

export function ErrorLine({ text }: { text: string }) {
  return (
    <div data-message className='flex min-w-0 items-start gap-1.25 text-red-text text-xs leading-relaxed'>
      <IconSlot>
        <Icon size='sm' name='IconExclamationCircle' />
      </IconSlot>
      <span className='selectable min-w-0 whitespace-pre-wrap break-words'>{text}</span>
    </div>
  );
}

export function AgentText({ text }: { text: string }) {
  return (
    <div data-message className='min-w-0'>
      <Markdown text={text} className='prose-chat' />
    </div>
  );
}

function DetailItem({ item, live }: { item: WorkItem; live: boolean }) {
  const persistId = useDisclosureScope('item', item.key);
  switch (item.kind) {
    case 'instructions':
      return (
        <ExpandRow
          persistId={persistId}
          icon='IconFileText'
          label={item.first ? 'Brief from Shinsa' : 'Message from Shinsa'}
        >
          <Markdown text={formatBrief(item.text)} className='prose-chat' />
        </ExpandRow>
      );
    case 'agent':
      return <Markdown text={item.text} className='prose-chat' />;
    case 'tools':
      return <ToolGroup persistId={persistId} calls={item.calls} live={live} />;
  }
}

const FIRST_ITEMS = 40;

export function TurnDetail({ items, run }: { items: WorkItem[]; run: Run }) {
  const live = run.endedAt === null;
  const shown = useProgressiveCount(items.length, FIRST_ITEMS);
  return (
    <div className='flex min-w-0 flex-col gap-4'>
      {items.slice(0, shown).map((item, index) => (
        <DetailItem key={item.key} item={item} live={live && index === items.length - 1} />
      ))}
    </div>
  );
}
