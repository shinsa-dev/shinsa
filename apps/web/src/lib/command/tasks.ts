import { type Command, type CommandSection, RANK } from '@/lib/command/registry.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import { selectTaskGroup, TASK_GROUPS, type TaskGroupKey } from '@/lib/tasks/groups.ts';
import { updateSearchParams } from '@/router.ts';

export function applySearch(text: string) {
  updateSearchParams({ q: text || null }, { replace: true });
}

export function listTaskListSections(search: string, status: TaskGroupKey | null): CommandSection[] {
  const commands: Command[] = [
    {
      kind: 'choice',
      id: 'tasks.status',
      label: 'Filter by status',
      hint: selectTaskGroup(status)?.title ?? 'Any status',
      icon: 'IconFilter1',
      keywords: ['filter', 'status', 'show only', 'group'],
      heading: 'Status',
      value: status ?? 'any',
      options: [
        { value: 'any', label: 'Any status', icon: 'IconListBullets', keywords: ['all', 'clear'] },
        ...TASK_GROUPS.map((group) => ({
          value: group.key,
          label: group.title,
          icon: { name: group.icon, className: TONE_TEXT[group.tone] },
        })),
      ],
      pick: (value) => updateSearchParams({ status: value === 'any' ? null : value }),
    },
    {
      kind: 'search',
      id: 'tasks.search',
      label: 'Search all tasks',
      icon: 'IconMagnifyingGlass',
      search: applySearch,
    },
  ];
  if (search || status) {
    commands.unshift({
      kind: 'run',
      id: 'tasks.clear',
      label: 'Clear filters',
      icon: 'IconCrossMedium',
      keywords: ['reset', 'remove', 'any', 'all'],
      run: () => updateSearchParams({ q: null, status: null }),
    });
  }
  return [{ id: 'tasks.filters', heading: 'Filters', rank: RANK.context, commands }];
}
