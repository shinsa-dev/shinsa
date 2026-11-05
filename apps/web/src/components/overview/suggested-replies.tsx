import type { ShinsaState, SuggestedAction, Task } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Hint } from '@/components/overlays/hint.tsx';
import { useBusy } from '@/hooks/use-busy.ts';
import { listSuggestedReplies, sendSuggestedReply } from '@/lib/overview/suggested-replies.ts';

function SuggestedReply({
  action,
  busy,
  send,
}: {
  action: SuggestedAction;
  busy: string | null;
  send: () => void;
}) {
  return (
    <Hint label={action.message}>
      <Button
        variant='outline'
        size='sm'
        loading={busy === action.label}
        disabled={busy !== null && busy !== action.label}
        onClick={send}
      >
        {action.label}
      </Button>
    </Hint>
  );
}

export function SuggestedReplies({ state, task }: { state: ShinsaState; task: Task }) {
  const { busy, run } = useBusy<string>();
  return listSuggestedReplies(state, task).map((action) => (
    <SuggestedReply
      key={action.label}
      action={action}
      busy={busy}
      send={() => void run(action.label, () => sendSuggestedReply(state, task, action))}
    />
  ));
}
