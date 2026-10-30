import type { UserCommand } from '@shinsa/core';
import { toast } from '@shinsa/ui/components/sonner';
import { sendCommand } from '@/lib/connection/socket.ts';

export type Done = string | { title: string; description: string };

export function describeFailure(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function confirm(done: Done) {
  if (typeof done === 'string') toast.success(done);
  else toast.success(done.title, { description: done.description });
}

export async function requestWithToast(request: () => Promise<unknown>, done?: Done) {
  try {
    await request();
    if (done) confirm(done);
    return true;
  } catch (error) {
    toast.error(describeFailure(error));
    return false;
  }
}

export function sendCommandWithToast(command: UserCommand, done?: string, machineId?: string | null) {
  return requestWithToast(() => sendCommand(command, machineId), done);
}

export function copyText(text: string) {
  return navigator.clipboard.writeText(text).then(
    () => {
      toast.success('Copied');
      return true;
    },
    () => {
      toast.error('Couldn’t copy to the clipboard');
      return false;
    }
  );
}
