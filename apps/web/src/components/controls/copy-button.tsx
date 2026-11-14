import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { iconSwap, iconSwapIn, iconSwapOut } from '@shinsa/ui/lib/icon-swap';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { Hint } from '@/components/overlays/hint.tsx';
import { copyText } from '@/lib/connection/commands.ts';
import { scheduleAfter } from '@/lib/runtime/timers.ts';

const COPIED_MS = 1500;

export function useCopyText(text: string) {
  const [copied, setCopied] = React.useState(false);
  const cancel = React.useRef<(() => void) | null>(null);

  function copy() {
    void copyText(text).then((done) => {
      if (!done) return;
      setCopied(true);
      cancel.current?.();
      cancel.current = scheduleAfter(COPIED_MS, () => setCopied(false));
    });
  }

  React.useEffect(() => () => cancel.current?.(), []);
  return { copied, copy };
}

export function CopyButton({
  text,
  label = 'Copy',
  size = 'icon-xs',
  className,
}: {
  text: string;
  label?: string;
  size?: 'icon-xs' | 'icon-sm';
  className?: string;
}) {
  const { copied, copy } = useCopyText(text);

  return (
    <Hint label={copied ? 'Copied' : label}>
      <Button
        variant='secondary'
        size={size}
        aria-label={copied ? 'Copied' : label}
        onClick={copy}
        className={className}
      >
        <Icon name='IconClipboard2' className={cn(iconSwap, copied ? iconSwapOut : iconSwapIn)} />
        <Icon
          name='IconCheckmark1'
          className={cn(
            'absolute inset-0 m-auto text-primary-text',
            iconSwap,
            copied ? iconSwapIn : iconSwapOut
          )}
        />
      </Button>
    </Hint>
  );
}

export function CopyLinkButton({
  url,
  label = 'Copy link',
  size,
}: {
  url: string;
  label?: string;
  size?: 'sm';
}) {
  const { copied, copy } = useCopyText(url);
  return (
    <Button variant='secondary' size={size} onClick={copy}>
      {copied ? 'Copied' : label}
    </Button>
  );
}
