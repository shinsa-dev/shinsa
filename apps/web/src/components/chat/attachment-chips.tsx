import { Button } from '@shinsa/ui/components/button';
import { Spinner } from '@shinsa/ui/components/spinner';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { FileCard } from '@/components/chat/file-card.tsx';
import { ATTACHMENT_CORNER, INSET } from '@/components/layout/surface/card.ts';
import { Hint } from '@/components/overlays/hint.tsx';
import { ImageViewer } from '@/components/overlays/image-viewer.tsx';
import type { Attachments } from '@/hooks/use-attachments.ts';
import { useImageViewer } from '@/hooks/use-image-viewer.ts';
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

interface DraftViewer {
  open: () => void;
  originRef: (element: HTMLElement | null) => void;
}

function DraftChip({
  draft,
  viewer,
  onRemove,
}: {
  draft: AttachmentDraft;
  viewer: DraftViewer | null;
  onRemove: () => void;
}) {
  const uploading = draft.stored === null;
  if (draft.preview && viewer) {
    return (
      <li className='relative'>
        <Hint label={`Open ${draft.name}`}>
          <button
            type='button'
            onClick={viewer.open}
            aria-label={`Open ${draft.name}`}
            className={cn(
              INSET,
              ATTACHMENT_CORNER,
              'relative block size-14 cursor-zoom-in overflow-hidden bg-bg-a1 hover:border-fg-a1 active:border-fg-a1'
            )}
          >
            <img
              ref={viewer.originRef}
              src={draft.preview}
              alt={draft.name}
              className='size-full object-cover'
            />
            {uploading && (
              <span className='absolute inset-0 grid place-items-center bg-background/60'>
                <Spinner size='sm' aria-label={`Attaching ${draft.name}`} />
              </span>
            )}
          </button>
        </Hint>
        <RemoveButton draft={draft} onRemove={onRemove} />
      </li>
    );
  }
  return (
    <li className='relative max-w-full'>
      <FileCard
        name={draft.name}
        mimeType={draft.mimeType}
        size={draft.size}
        busy={uploading}
        busyLabel='Attaching…'
      />
      <RemoveButton draft={draft} onRemove={onRemove} />
    </li>
  );
}

export function AttachmentChips({ attachments }: { attachments: Attachments }) {
  const viewer = useImageViewer();
  if (attachments.drafts.length === 0) return null;
  const images = attachments.drafts.flatMap((draft) =>
    draft.kind === 'image' && draft.preview
      ? [{ key: draft.key, src: draft.preview, caption: draft.name }]
      : []
  );
  return (
    <>
      <ul aria-label='Attachments' className='flex flex-wrap gap-2 px-3 pt-3'>
        {attachments.drafts.map((draft) => {
          const at = images.findIndex((image) => image.key === draft.key);
          return (
            <DraftChip
              key={draft.key}
              draft={draft}
              viewer={at < 0 ? null : { open: () => viewer.show(at), originRef: viewer.recordOrigin(at) }}
              onRemove={() => attachments.remove(draft.key)}
            />
          );
        })}
      </ul>
      <ImageViewer images={images} viewer={viewer} />
    </>
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
