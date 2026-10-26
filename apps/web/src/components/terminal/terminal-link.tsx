import { Button } from '@shinsa/ui/components/button';
import { cn } from '@shinsa/ui/lib/utils';
import { Hint } from '@/components/overlays/hint.tsx';
import { resolveTerminalEntry } from '@/lib/terminal/tabs.ts';
import { navigate, useRoute } from '@/router.ts';

export function TerminalButton({ className }: { className?: string }) {
  const active = useRoute().name === 'terminal';
  return (
    <Hint label='Terminal' detail='Your own shell in one of a project’s folders'>
      <Button
        variant='secondary'
        size='icon-sm'
        icon='IconConsole'
        aria-label='Terminal'
        aria-current={active ? 'page' : undefined}
        className={cn(active && 'text-fg-4', className)}
        onClick={() => navigate(resolveTerminalEntry())}
      />
    </Hint>
  );
}
