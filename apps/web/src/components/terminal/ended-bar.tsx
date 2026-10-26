import type { TerminalInfo } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { describeTerminalEnd } from '@/lib/terminal/tabs.ts';

export function EndedBar({
  terminal,
  onRestart,
  onClose,
}: {
  terminal: TerminalInfo;
  onRestart: () => void;
  onClose: () => void;
}) {
  const ended = describeTerminalEnd(terminal);
  if (!ended) return null;
  return (
    <div className='flex w-full shrink-0 items-center gap-2 border-border border-t px-3 py-1.5'>
      <span className='min-w-0 flex-1 truncate text-fg-2 text-xs'>{ended}</span>
      <Button variant='secondary' size='sm' onClick={onClose}>
        Close
      </Button>
      <Button size='sm' icon='IconArrowRotateClockwise' onClick={onRestart}>
        Start again
      </Button>
    </div>
  );
}
