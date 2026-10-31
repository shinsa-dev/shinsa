import { serializeAttachments } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { ScrollFade } from '@shinsa/ui/components/scroll-fade';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { AttachButton, AttachmentChips, useFileDrop } from '@/components/chat/attachment-chips.tsx';
import { COMPOSER_FIELD, COMPOSER_FOOTER, INSET } from '@/components/layout/surface/card.ts';
import { useAttachments } from '@/hooks/use-attachments.ts';
import { canSendDraft } from '@/lib/chat/attachment-drafts.ts';
import { isSubmitKey } from '@/lib/keys.ts';

export function AnswerBox({
  label,
  placeholder,
  submitLabel,
  busy,
  onSubmit,
}: {
  label: string;
  placeholder: string;
  submitLabel: string;
  busy: boolean;
  onSubmit: (text: string) => Promise<boolean>;
}) {
  const [text, setText] = React.useState('');
  const field = React.useRef<HTMLTextAreaElement>(null);
  const attachments = useAttachments();
  const { dragging, dropProps, onPaste } = useFileDrop(attachments);
  const ready = canSendDraft(text, attachments.drafts, busy);

  async function submit() {
    if (!ready) return;
    const sent = await onSubmit(serializeAttachments(text, attachments.ready));
    if (!sent) return;
    setText('');
    attachments.clear();
  }

  return (
    <div {...dropProps} className={cn(INSET, 'flex flex-col bg-bg-a1', dragging && 'border-primary')}>
      <AttachmentChips attachments={attachments} />
      <textarea
        ref={field}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onPaste={onPaste}
        onKeyDown={(event) => {
          if (!isSubmitKey(event)) return;
          event.preventDefault();
          void submit();
        }}
        rows={2}
        aria-label={label}
        placeholder={placeholder}
        className={cn(COMPOSER_FIELD, 'max-h-48 min-h-14')}
      />
      <ScrollFade targetRef={field} />
      <div className={COMPOSER_FOOTER}>
        <AttachButton attachments={attachments} />
        <span className='flex-1' />
        <Button size='sm' disabled={!ready} loading={busy} onClick={() => void submit()}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
