import { serializeAttachments } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { ScrollFade } from '@shinsa/ui/components/scroll-fade';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { AttachButton, AttachmentChips, useFileDrop } from '@/components/chat/attachment-chips.tsx';
import { PAGE_COLUMN } from '@/components/layout/page/column.ts';
import { CARD, COMPOSER_FIELD, COMPOSER_FOOTER } from '@/components/layout/surface/card.ts';
import { Hint } from '@/components/overlays/hint.tsx';
import { useAttachments } from '@/hooks/use-attachments.ts';
import { canSendDraft } from '@/lib/chat/attachment-drafts.ts';
import {
  clearTaskDraft,
  resolveTaskDraft,
  subscribeTaskDrafts,
  updateTaskDraft,
} from '@/lib/chat/task-drafts.ts';
import { isSubmitKey } from '@/lib/keys.ts';

export function Composer({
  draftKey,
  placeholder,
  submitLabel,
  onSubmit,
  aside,
  dock,
}: {
  draftKey: string;
  placeholder: string;
  submitLabel: string;
  onSubmit: (text: string) => Promise<boolean>;
  aside?: React.ReactNode;
  dock?: React.ReactNode;
}) {
  const text = React.useSyncExternalStore(subscribeTaskDrafts, () => resolveTaskDraft(draftKey).text);
  const [busy, setBusy] = React.useState(false);
  const field = React.useRef<HTMLTextAreaElement>(null);
  const attachments = useAttachments(draftKey);
  const { dragging, dropProps, onPaste } = useFileDrop(attachments);
  const ready = canSendDraft(text, attachments.drafts, busy);

  async function submit() {
    if (!ready) return;
    setBusy(true);
    const sent = await onSubmit(serializeAttachments(text, attachments.ready));
    setBusy(false);
    if (sent) clearTaskDraft(draftKey);
    field.current?.focus();
  }

  return (
    <div className='sticky bottom-0 z-20 bg-background pt-1 pb-3'>
      <div className={PAGE_COLUMN}>
        {dock}
        <div {...dropProps} className={cn(CARD, 'flex flex-col', dragging && 'border-primary')}>
          <AttachmentChips attachments={attachments} />
          <textarea
            ref={field}
            value={text}
            onChange={(event) => {
              const typed = event.target.value;
              updateTaskDraft(draftKey, () => ({ text: typed }));
            }}
            onPaste={onPaste}
            onKeyDown={(event) => {
              if (!isSubmitKey(event)) return;
              event.preventDefault();
              void submit();
            }}
            rows={1}
            aria-label={placeholder}
            placeholder={placeholder}
            className={cn(COMPOSER_FIELD, 'max-h-40 min-h-10')}
          />
          <ScrollFade targetRef={field} />
          <div className={COMPOSER_FOOTER}>
            <AttachButton attachments={attachments} />
            {aside}
            <span className='flex-1' />
            <Hint label={submitLabel}>
              <Button
                size='icon-sm'
                variant={ready || busy ? 'primary' : 'secondary'}
                aria-label={submitLabel}
                disabled={!ready}
                loading={busy}
                onClick={() => void submit()}
              >
                {!busy && <Icon name='IconArrowUp' />}
              </Button>
            </Hint>
          </div>
        </div>
      </div>
    </div>
  );
}
