import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { CopyButton } from '@/components/controls/copy-button.tsx';
import { INSET } from '@/components/layout/surface/card.ts';
import { Hint } from '@/components/overlays/hint.tsx';
import type { CodeCorner } from '@/lib/code/block.ts';
import { shortenHomePath } from '@/lib/evidence/layout.ts';

export interface CommandRunner {
  run: (command: string) => unknown;
  folder: string;
}

const CommandRunnerContext = React.createContext<CommandRunner | null>(null);

export function CommandRunnerProvider({
  runner,
  children,
}: {
  runner: CommandRunner | null;
  children: React.ReactNode;
}) {
  return <CommandRunnerContext value={runner}>{children}</CommandRunnerContext>;
}

const CORNER_POSITION: Record<CodeCorner, string> = {
  centre: 'shrink-0 pe-1.5',
  top: 'absolute top-0 right-0 bg-linear-to-r from-transparent to-[12px] to-bg-2 ps-3 pe-1.5 pt-1.5',
};

function RunButton({ command, runner }: { command: string; runner: CommandRunner }) {
  return (
    <Hint label='Run in terminal' detail={shortenHomePath(runner.folder)}>
      <Button
        variant='secondary'
        size='icon-xs'
        aria-label='Run in terminal'
        onClick={() => runner.run(command)}
      >
        <Icon name='IconConsole' />
      </Button>
    </Hint>
  );
}

export function CodeBlock({
  copy,
  command = null,
  corner = 'top',
  className,
  children,
}: {
  copy: string | null;
  command?: string | null;
  corner?: CodeCorner;
  className?: string;
  children: React.ReactNode;
}) {
  const runner = React.useContext(CommandRunnerContext);
  const centred = copy !== null && corner === 'centre';
  return (
    <div
      className={cn(
        INSET,
        'group/code selectable relative min-w-0 overflow-hidden bg-bg-2',
        centred && 'flex items-center',
        className
      )}
    >
      {centred ? <div className='min-w-0 flex-1'>{children}</div> : children}
      {copy !== null && (
        <div
          data-slot='code-corner'
          data-corner={corner}
          className={cn(
            'pointer-events-none flex opacity-0 pointer-coarse:opacity-100 group-hover/code:opacity-100 has-[:focus-visible]:opacity-100',
            CORNER_POSITION[corner]
          )}
        >
          <span className='pointer-events-auto flex items-center rounded-control border border-border bg-bg-2'>
            <CopyButton text={copy} />
            {command && runner && <RunButton command={command} runner={runner} />}
          </span>
        </div>
      )}
    </div>
  );
}
