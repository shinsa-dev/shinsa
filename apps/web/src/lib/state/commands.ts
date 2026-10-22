import type { UserCommand } from '@shinsa/core';
import { toast } from '@shinsa/ui/components/sonner';
import { sendCommand } from './connection.ts';

export function describeFailure(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function sendCommandWithToast(command: UserCommand, done?: string) {
  try {
    await sendCommand(command);
    if (done) toast.success(done);
    return true;
  } catch (error) {
    toast.error(describeFailure(error));
    return false;
  }
}

export function copyText(text: string, done: string) {
  return navigator.clipboard.writeText(text).then(
    () => {
      toast.success(done);
    },
    () => {
      toast.error('Could not copy to the clipboard.');
    }
  );
}
