import type { ShinsaState, Task } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shinsa/ui/components/dropdown-menu';
import { useBusy } from '@/hooks/use-busy.ts';
import { listSuggestedReplies, sendSuggestedReply } from '@/lib/overview/suggested-replies.ts';

export function SuggestedReplies({ state, task }: { state: ShinsaState; task: Task }) {
  const { busy, run } = useBusy<string>();
  const actions = listSuggestedReplies(state, task);
  if (actions.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={busy !== null}
        render={
          <Button
            variant='outline'
            size='sm'
            loading={busy !== null}
            icon={{ name: 'IconChevronDownMedium', position: 'inline-end' }}
          >
            Replies
          </Button>
        }
      />
      <DropdownMenuContent align='end' className='w-72 whitespace-normal'>
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.label}
            onClick={() => void run(action.label, () => sendSuggestedReply(state, task, action))}
          >
            <span className='flex min-w-0 flex-col py-0.5'>
              <span className='text-fg-4'>{action.label}</span>
              <span className='line-clamp-2 font-normal text-fg-2'>{action.message}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
