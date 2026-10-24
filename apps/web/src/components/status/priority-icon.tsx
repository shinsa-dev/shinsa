import type { TaskPriority } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import { PRIORITY_ICON } from '@/lib/format/labels.ts';

export function PriorityIcon({ priority, className }: { priority: TaskPriority; className?: string }) {
  const icon = PRIORITY_ICON[priority];
  return <Icon name={icon.name} size='sm' className={cn(icon.className, className)} />;
}
