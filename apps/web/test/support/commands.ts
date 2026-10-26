import { spyOn } from 'bun:test';
import { toast } from '@shinsa/ui/components/sonner';
import * as commands from '@/lib/connection/commands.ts';
import * as terminals from '@/lib/connection/terminals.ts';
import * as worktree from '@/lib/connection/worktree.ts';

export function spyOnCommands() {
  const sent = spyOn(commands, 'sendCommandWithToast').mockResolvedValue(true);
  const copied = spyOn(commands, 'copyText').mockResolvedValue(true);
  const opened = spyOn(worktree, 'openWorktree').mockResolvedValue(true);
  const terminal = spyOn(terminals, 'openTaskTerminal').mockResolvedValue(true);
  return {
    sent,
    copied,
    opened,
    terminal,
    restore() {
      sent.mockRestore();
      copied.mockRestore();
      opened.mockRestore();
      terminal.mockRestore();
    },
  };
}

export function spyOnToasts() {
  const success = spyOn(toast, 'success').mockReturnValue('id');
  const error = spyOn(toast, 'error').mockReturnValue('id');
  return {
    success,
    error,
    restore() {
      success.mockRestore();
      error.mockRestore();
    },
  };
}
