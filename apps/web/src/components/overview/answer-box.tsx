import { Button } from '@shinsa/ui/components/button';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { COMPOSER_FIELD, COMPOSER_FOOTER } from '@/components/layout/surface/card.ts';
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
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = React.useState('');

  function submit() {
    const value = text.trim();
    if (value) onSubmit(value);
  }

  return (
    <div className='corner-superellipse/1.125 flex flex-col rounded-lg border border-border bg-bg-a1'>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (!isSubmitKey(event)) return;
          event.preventDefault();
          submit();
        }}
        rows={2}
        aria-label={label}
        placeholder={placeholder}
        className={cn(COMPOSER_FIELD, 'max-h-48 min-h-14')}
      />
      <div className={cn(COMPOSER_FOOTER, 'justify-end')}>
        <Button size='sm' disabled={!text.trim()} loading={busy} onClick={submit}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
