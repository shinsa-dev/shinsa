import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { iconSwap, iconSwapIn, iconSwapOut } from '@shinsa/ui/lib/icon-swap';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { Hint } from '@/components/overlays/hint.tsx';
import { copyText } from '@/lib/connection/commands.ts';

const COPIED_MS = 1500;

export function useCopyText(text: string) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);

  function copy() {
    void copyText(text).then((done) => {
      if (!done) return;
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    });
  }

  React.useEffect(() => () => clearTimeout(timer.current), []);
  return { copied, copy };
}

export function CopyButton({ text, className }: { text: string; className?: string }) {
  const { copied, copy } = useCopyText(text);

  return (
    <Hint label={copied ? 'Copied' : 'Copy'}>
      <Button
        variant='secondary'
        size='icon-xs'
        aria-label={copied ? 'Copied' : 'Copy'}
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
