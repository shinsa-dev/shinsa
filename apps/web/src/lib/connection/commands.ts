import type { UserCommand } from '@shinsa/core';
import { toast } from '@shinsa/ui/components/sonner';
import { sendCommand } from '@/lib/connection/socket.ts';

export function describeFailure(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function confirmDone(done: string) {
  toast.success(done);
}

export async function requestWithToast(request: () => Promise<unknown>, done?: string) {
  try {
    await request();
    if (done) confirmDone(done);
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
