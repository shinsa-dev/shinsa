import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { PAGE_COLUMN } from '@/components/layout/page/column.ts';
import { CARD, COMPOSER_FIELD, COMPOSER_FOOTER } from '@/components/layout/surface/card.ts';
import { Hint } from '@/components/overlays/hint.tsx';
import { isSubmitKey } from '@/lib/keys.ts';

export function Composer({
  placeholder,
  submitLabel,
  onSubmit,
  aside,
}: {
  placeholder: string;
  submitLabel: string;
  onSubmit: (text: string) => Promise<boolean>;
  aside?: React.ReactNode;
}) {
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const field = React.useRef<HTMLTextAreaElement>(null);
  const ready = text.trim().length > 0 && !busy;

  async function submit() {
    if (!ready) return;
    setBusy(true);
    const sent = await onSubmit(text.trim());
    setBusy(false);
    if (sent) setText('');
    field.current?.focus();
  }

  return (
    <div className='sticky bottom-0 z-20 bg-background pt-1 pb-3'>
      <div className={PAGE_COLUMN}>
        <div className={cn(CARD, 'flex flex-col')}>
          <textarea
            ref={field}
            value={text}
            onChange={(event) => setText(event.target.value)}
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
          <div className={COMPOSER_FOOTER}>
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
