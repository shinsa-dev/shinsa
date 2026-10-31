import type { ChecklistItem } from '@shinsa/core';
import { Checkbox } from '@shinsa/ui/components/checkbox';
import {
  ChecklistActions,
  ChecklistDetail,
  ChecklistHeader,
  ChecklistMark,
  ChecklistItem as ChecklistRow,
  Checklist as ChecklistRows,
  ChecklistTitle,
} from '@shinsa/ui/components/checklist';
import * as React from 'react';
import { Hint } from '@/components/overlays/hint.tsx';
import { CodeFence } from '@/components/text/code-fence.tsx';
import { LinkedInlineMarkdown, Markdown } from '@/components/text/markdown.tsx';
import { describeChecklistProgress } from '@/lib/format/checklist.ts';

export interface ChecklistProps<Item extends ChecklistItem> {
  items: readonly Item[];
  onTick?: (item: Item, done: boolean) => unknown;
  describeBlock?: (item: Item) => string | null;
  meta?: (item: Item) => React.ReactNode;
  actions?: (item: Item) => React.ReactNode;
}

function ItemCheck<Item extends ChecklistItem>({
  item,
  onTick,
  block,
}: {
  item: Item;
  onTick: (item: Item, done: boolean) => unknown;
  block: string | null;
}) {
  const [pending, setPending] = React.useState(false);
  const box = (
    <Checkbox
      size='sm'
      checked={item.done}
      disabled={block !== null || pending}
      aria-label={item.title}
      onCheckedChange={(checked) => {
        setPending(true);
        void Promise.resolve(onTick(item, checked)).finally(() => setPending(false));
      }}
    />
  );
  if (!block) return box;
  return (
    <Hint label={block}>
      <span className='flex w-fit'>{box}</span>
    </Hint>
  );
}

export function ItemChecklist<Item extends ChecklistItem>({
  items,
  onTick,
  describeBlock = () => null,
  meta,
  actions,
}: ChecklistProps<Item>) {
  return (
    <ChecklistRows>
      {items.map((item) => {
        const action = actions?.(item);
        return (
          <ChecklistRow
            key={item.key}
            done={item.done}
            check={
              onTick ? (
                <ItemCheck item={item} onTick={onTick} block={describeBlock(item)} />
              ) : (
                <ChecklistMark done={item.done} />
              )
            }
          >
            <ChecklistTitle meta={meta?.(item)}>
              <LinkedInlineMarkdown text={item.title} />
            </ChecklistTitle>
            {item.detail && (
              <ChecklistDetail>
                <Markdown text={item.detail} />
              </ChecklistDetail>
            )}
            {(item.command || action) && (
              <ChecklistActions>
                {item.command && (
                  <div className='w-full'>
                    <CodeFence code={item.command} language='sh' runnable />
                  </div>
                )}
                {action}
              </ChecklistActions>
            )}
          </ChecklistRow>
        );
      })}
    </ChecklistRows>
  );
}

export function ChecklistBlock<Item extends ChecklistItem>({
  title,
  ...props
}: ChecklistProps<Item> & { title: string }) {
  if (props.items.length === 0) return null;
  return (
    <div className='flex flex-col gap-2'>
      <ChecklistHeader title={title} progress={describeChecklistProgress(props.items)} />
      <ItemChecklist {...props} />
    </div>
  );
}
