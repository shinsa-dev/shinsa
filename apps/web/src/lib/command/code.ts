import { type CodeKey, describeCodeKey } from '@/lib/code/keys.ts';
import type { CodeMode } from '@/lib/code/location.ts';
import { type Command, type CommandSection, RANK } from '@/lib/command/registry.ts';
import { CODE_MODE, type ExplorerMode } from '@/lib/tasks/tabs.ts';

export interface CodeCommandContext {
  taskId: string;
  modes: ExplorerMode[];
  mode: CodeMode;
  mac: boolean;
  split: boolean;
  hideViewed: boolean;
  hasEditor: boolean;
  applyMode: (mode: CodeMode) => void;
  run: (key: CodeKey) => void;
  toggleSplit: () => void;
  toggleHideViewed: () => void;
}

export function listCodeCommands(context: CodeCommandContext): CommandSection {
  const id = `task.${context.taskId}.code`;
  const modes: Command[] = context.modes.map((mode) => ({
    kind: 'run',
    id: `${id}.mode.${mode}`,
    label: CODE_MODE[mode].label,
    icon: CODE_MODE[mode].icon,
    current: context.mode === mode,
    keywords: ['code', 'view', 'explorer'],
    run: () => context.applyMode(mode),
  }));
  const keys: Command[] = [
    {
      kind: 'run',
      id: `${id}.quick-open`,
      label: 'Go to file…',
      icon: 'IconFileText',
      trailing: describeCodeKey('quick-open', context.mac),
      keywords: ['open', 'file', 'quick open', 'find file'],
      run: () => context.run('quick-open'),
    },
    {
      kind: 'run',
      id: `${id}.search`,
      label: 'Search in files',
      icon: 'IconMagnifyingGlass',
      trailing: describeCodeKey('search', context.mac),
      keywords: ['grep', 'find', 'text', 'everywhere'],
      run: () => context.run('search'),
    },
  ];
  if (context.modes.includes('changes')) {
    keys.push({
      kind: 'run',
      id: `${id}.hide-viewed`,
      label: context.hideViewed ? 'Show viewed files' : 'Hide viewed files',
      icon: context.hideViewed ? 'IconEyeSlash' : 'IconEyeOpen',
      keywords: ['viewed', 'hide', 'show', 'changes', 'reviewed'],
      run: context.toggleHideViewed,
    });
  }
  if (context.hasEditor) {
    keys.push(
      {
        kind: 'run',
        id: `${id}.find`,
        label: 'Find in this file',
        icon: 'IconPageSearch',
        trailing: describeCodeKey('find', context.mac),
        keywords: ['find', 'search', 'file'],
        run: () => context.run('find'),
      },
      {
        kind: 'run',
        id: `${id}.goto-line`,
        label: 'Go to line',
        icon: 'IconHashtag',
        trailing: describeCodeKey('goto-line', context.mac),
        keywords: ['line', 'jump', 'number'],
        run: () => context.run('goto-line'),
      },
      {
        kind: 'run',
        id: `${id}.split`,
        label: context.split ? 'Show diffs unified' : 'Show diffs side by side',
        icon: context.split ? 'IconLayoutTopBottom' : 'IconLayoutColumn',
        keywords: ['diff', 'split', 'side by side', 'unified', 'layout'],
        run: context.toggleSplit,
      }
    );
  }
  return { id, heading: 'Code', rank: RANK.context, commands: [...modes, ...keys] };
}
