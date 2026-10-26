import type { TerminalInfo } from '@shinsa/core';
import { EmptyState } from '@shinsa/ui/components/empty-state';
import { Toolbar } from '@/components/layout/page/toolbar.tsx';
import { EndedBar } from '@/components/terminal/ended-bar.tsx';
import { NewTerminalButton } from '@/components/terminal/place-menu.tsx';
import { TerminalTabs } from '@/components/terminal/tab-bar.tsx';
import type { PlaceGroup } from '@/lib/terminal/tabs.ts';
import { readDocumentVariable, resolveShinsaTheme } from '@/lib/terminal/theme.ts';
import { acknowledgeSample } from './samples.ts';
import { Specimen } from './section.tsx';

const BASE: TerminalInfo = {
  id: 'server',
  projectId: 'shop',
  name: 'Dev server',
  title: 'bun dev',
  cwd: '~/Developer/shop',
  place: 'repository',
  taskId: null,
  status: 'running',
  exitCode: null,
  startedAt: 0,
  endedAt: null,
};

const TERMINALS: TerminalInfo[] = [
  BASE,
  { ...BASE, id: 'shell', name: null, title: 'fish' },
  { ...BASE, id: 'tests', name: null, title: 'bun test', status: 'exited', exitCode: 1, endedAt: 1 },
  { ...BASE, id: 'old', name: 'Logs', status: 'stopped', endedAt: 1 },
];

const GROUPS: PlaceGroup[] = [
  {
    kind: 'repository',
    heading: 'Repositories',
    places: [
      { path: '~/Developer/shop', label: 'shop', kind: 'repository', taskId: null },
      { path: '~/Developer/shop-api', label: 'shop-api', kind: 'repository', taskId: null },
    ],
  },
  {
    kind: 'worktree',
    heading: 'Task worktrees',
    places: [
      {
        path: '~/.config/shinsa/data/worktrees/sh-4',
        label: 'SH-4 Fix the cart',
        kind: 'worktree',
        taskId: 'sh-4',
      },
    ],
  },
];

function Palette() {
  const theme = resolveShinsaTheme(readDocumentVariable);
  const names = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const;
  return (
    <div
      style={{ background: theme.background, color: theme.foreground }}
      className='flex w-full flex-col gap-1 rounded-lg p-3 font-mono text-xs'
    >
      <span>The --terminal-* tokens, used where no Ghostty config sets a colour</span>
      <span className='flex flex-wrap gap-3'>
        {names.map((name) => (
          <span key={name} style={{ color: theme[name] }}>
            {name}
          </span>
        ))}
      </span>
    </div>
  );
}

export function TerminalSpecimens() {
  return (
    <>
      <Specimen label='TerminalTabs · a named tab, the shell’s title, an exited shell, one the engine restart ended'>
        <Toolbar className='w-full gap-1.5 ps-2'>
          <TerminalTabs
            terminals={TERMINALS}
            activeId='server'
            renamingId={null}
            onSelect={acknowledgeSample}
            onClose={acknowledgeSample}
            onRenameStart={acknowledgeSample}
            onRename={acknowledgeSample}
            onReorder={acknowledgeSample}
          />
          <NewTerminalButton groups={GROUPS} fallback={null} onOpen={acknowledgeSample} />
        </Toolbar>
      </Specimen>
      <Specimen label='TerminalTabs · renaming a tab'>
        <Toolbar className='w-full gap-1.5 ps-2'>
          <TerminalTabs
            terminals={TERMINALS.slice(0, 2)}
            activeId='server'
            renamingId='server'
            onSelect={acknowledgeSample}
            onClose={acknowledgeSample}
            onRenameStart={acknowledgeSample}
            onRename={acknowledgeSample}
            onReorder={acknowledgeSample}
          />
        </Toolbar>
      </Specimen>
      <Specimen label='EndedBar · the shell exited, and the engine restarted under it'>
        <div className='flex w-full flex-col'>
          <EndedBar
            terminal={TERMINALS[2] ?? BASE}
            onRestart={acknowledgeSample}
            onClose={acknowledgeSample}
          />
          <EndedBar
            terminal={TERMINALS[3] ?? BASE}
            onRestart={acknowledgeSample}
            onClose={acknowledgeSample}
          />
        </div>
      </Specimen>
      <Specimen label='The empty project, with the place menu'>
        <EmptyState
          icon='IconConsole'
          title='No terminals in Shop'
          description='A terminal runs your own shell in one of the project’s folders, and keeps running when you close Shinsa.'
        >
          <NewTerminalButton
            groups={GROUPS}
            fallback={null}
            label='Open a terminal'
            wide
            onOpen={acknowledgeSample}
          />
        </EmptyState>
      </Specimen>
      <Specimen label='Shinsa’s terminal colours in this theme'>
        <Palette />
      </Specimen>
    </>
  );
}
