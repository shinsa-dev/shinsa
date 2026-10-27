import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { Spinner } from '@shinsa/ui/components/spinner';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { INSET } from '@/components/layout/surface/card.ts';
import { Hint } from '@/components/overlays/hint.tsx';
import type { Attachments } from '@/hooks/use-attachments.ts';
import type { AttachmentDraft } from '@/lib/chat/attachment-drafts.ts';

function RemoveButton({ draft, onRemove }: { draft: AttachmentDraft; onRemove: () => void }) {
  return (
    <Button
      variant='outline'
      size='icon-2xs'
      icon='IconCrossSmall'
      aria-label={`Remove ${draft.name}`}
      onClick={onRemove}
      className='absolute -top-1.5 -right-1.5 rounded-full'
    />
  );
}

function DraftChip({ draft, onRemove }: { draft: AttachmentDraft; onRemove: () => void }) {
  const uploading = draft.stored === null;
  if (draft.kind === 'image' && draft.preview) {
    return (
      <li className='relative'>
        <Hint label={draft.name}>
          <span className={cn(INSET, 'relative block size-12 overflow-hidden bg-bg-a1')}>
            <img src={draft.preview} alt={draft.name} className='size-full object-cover' />
            {uploading && (
              <span className='absolute inset-0 grid place-items-center bg-background/60'>
                <Spinner size='sm' aria-label={`Attaching ${draft.name}`} />
              </span>
            )}
          </span>
        </Hint>
        <RemoveButton draft={draft} onRemove={onRemove} />
      </li>
    );
  }
  return (
    <li className='relative'>
      <span className={cn(INSET, 'flex h-12 min-w-0 max-w-56 items-center gap-2 bg-bg-a1 ps-2 pe-3')}>
        <span className='grid size-8 shrink-0 place-items-center text-fg-2'>
          {uploading ? (
            <Spinner size='sm' aria-label={`Attaching ${draft.name}`} />
          ) : (
            <Icon size='md' name='IconFileText' />
          )}
        </span>
        <Truncate className='text-fg-4 text-xs'>{draft.name}</Truncate>
      </span>
      <RemoveButton draft={draft} onRemove={onRemove} />
    </li>
  );
}

export function AttachmentChips({ attachments }: { attachments: Attachments }) {
  if (attachments.drafts.length === 0) return null;
  return (
    <ul aria-label='Attachments' className='flex flex-wrap gap-2 px-3 pt-3'>
      {attachments.drafts.map((draft) => (
        <DraftChip key={draft.key} draft={draft} onRemove={() => attachments.remove(draft.key)} />
      ))}
    </ul>
  );
}

export function AttachButton({ attachments }: { attachments: Attachments }) {
  const input = React.useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type='file'
        multiple
        hidden
        aria-hidden
        tabIndex={-1}
        onChange={(event) => {
          attachments.add(Array.from(event.target.files ?? []));
          event.target.value = '';
        }}
      />
      <Hint label='Attach files'>
        <Button
          size='icon-sm'
          variant='secondary'
          icon='IconPaperclip1'
          aria-label='Attach files'
          onClick={() => input.current?.click()}
        />
      </Hint>
    </>
  );
}

function hasFiles(event: React.DragEvent) {
  return Array.from(event.dataTransfer.types).includes('Files');
}

export function useFileDrop(attachments: Attachments) {
  const [dragging, setDragging] = React.useState(false);
  return {
    dragging,
    dropProps: {
      onDragOver: (event: React.DragEvent) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setDragging(true);
      },
      onDragLeave: (event: React.DragEvent) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      },
      onDrop: (event: React.DragEvent) => {
        setDragging(false);
        if (!hasFiles(event)) return;
        event.preventDefault();
        attachments.addTransfer(event.dataTransfer);
      },
    },
    onPaste: (event: React.ClipboardEvent) => {
      if (attachments.addTransfer(event.clipboardData)) event.preventDefault();
    },
  };
}
