import type { UserCommand } from '@shinsa/core';
import { toast } from '@shinsa/ui/components/sonner';
import { Effect } from 'effect';
import { sendCommand } from '@/lib/connection/socket.ts';
import { runApp } from '@/lib/runtime/app.ts';
import { StepFailed } from '@/lib/runtime/schema.ts';

export function describeFailure(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function confirmDone(done: string) {
  toast.success(done);
}

export function requestWithToast(request: () => Promise<unknown>, done?: string) {
  return runApp(
    Effect.tryPromise({
      try: request,
      catch: (error) => new StepFailed({ message: describeFailure(error) }),
    }).pipe(
      Effect.map(() => {
        if (done) confirmDone(done);
        return true;
      }),
      Effect.catchTag('StepFailed', (failed) =>
        Effect.sync(() => {
          toast.error(failed.message);
          return false;
        })
      )
    )
  );
}

export function sendCommandWithToast(command: UserCommand, done?: string, machineId?: string | null) {
  return requestWithToast(() => sendCommand(command, machineId), done);
}

export function copyText(text: string) {
  return runApp(
    Effect.tryPromise({
      try: () => navigator.clipboard.writeText(text),
      catch: () => new StepFailed({ message: 'Couldn’t copy to the clipboard' }),
    }).pipe(
      Effect.map(() => {
        toast.success('Copied');
        return true;
      }),
      Effect.catchTag('StepFailed', (failed) =>
        Effect.sync(() => {
          toast.error(failed.message);
          return false;
        })
      )
    )
  );
}
