import { Button } from '@shinsa/ui/components/button';
import { cn } from '@shinsa/ui/lib/utils';
import { StatusLetter } from '@/components/code/changes-tree.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { type CodeTabRef, resolveTabKey } from '@/lib/code/location.ts';
import { listTabLabels, type TabSource } from '@/lib/code/tabs.ts';

export function EditorTabs({
  sources,
  active,
  preview,
  onSelect,
  onPin,
  onClose,
}: {
  sources: TabSource[];
  active: CodeTabRef | null;
  preview: string | null;
  onSelect: (tab: CodeTabRef) => void;
  onPin: (tab: CodeTabRef) => void;
  onClose: (tab: CodeTabRef) => void;
}) {
  if (sources.length === 0) return null;
  const labels = listTabLabels(sources.map((source) => source.tab));
  return (
    <div
      role='tablist'
      aria-label='Open files'
      className='scrollbar-hide flex h-9 shrink-0 items-stretch overflow-x-auto border-border border-b'
    >
      {sources.map((source, index) => {
        const key = resolveTabKey(source.tab);
        const selected = active !== null && resolveTabKey(active) === key;
        const label = labels[index];
        const kind = source.tab.kind === 'diff' ? 'Changes in' : 'File';
        return (
          <div
            key={key}
            className={cn(
              'group/tab flex shrink-0 items-center gap-1.5 border-border border-r ps-3 pe-1.5 text-xs transition-colors duration-150',
              selected ? 'bg-background text-fg-4' : 'bg-bg-a1 text-fg-2 hover:text-fg-4 active:text-fg-4'
            )}
          >
            <Hint label={`${kind} ${source.tab.path}`}>
              <button
                type='button'
                role='tab'
                aria-selected={selected}
                onClick={() => onSelect(source.tab)}
                onDoubleClick={() => onPin(source.tab)}
                className='flex h-full w-fit cursor-pointer items-center gap-1.5 outline-none'
              >
                {source.file && <StatusLetter status={source.file.status} plain />}
                <span className={cn(preview === key && 'text-fg-2')}>{label?.name}</span>
                {label?.hint && <span className='text-2xs text-fg-2'>{label.hint}</span>}
              </button>
            </Hint>
            <Hint label='Close'>
              <Button
                variant='secondary'
                size='icon-xs'
                icon='IconCrossSmall'
                aria-label={`Close ${label?.name ?? source.tab.path}`}
                onClick={() => onClose(source.tab)}
                className={cn(
                  !selected && 'opacity-0 group-hover/tab:opacity-100 group-active/tab:opacity-100'
                )}
              />
            </Hint>
          </div>
        );
      })}
    </div>
  );
}
