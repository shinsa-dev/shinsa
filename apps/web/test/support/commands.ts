import { spyOn } from 'bun:test';
import { toast } from '@shinsa/ui/components/sonner';
import * as commands from '@/lib/connection/commands.ts';
import * as terminals from '@/lib/connection/terminals.ts';
import * as worktree from '@/lib/connection/worktree.ts';
import { addTeardown } from './teardown.ts';

export function spyOnCommands() {
  const sent = spyOn(commands, 'sendCommandWithToast').mockResolvedValue(true);
  const copied = spyOn(commands, 'copyText').mockResolvedValue(true);
  const opened = spyOn(worktree, 'openWorktree').mockResolvedValue(true);
  const terminal = spyOn(terminals, 'openTaskTerminal').mockResolvedValue(true);
  const restore = () => {
    sent.mockRestore();
    copied.mockRestore();
    opened.mockRestore();
    terminal.mockRestore();
  };
  addTeardown(restore);
  return { sent, copied, opened, terminal, restore };
}

export function spyOnToasts() {
  const success = spyOn(toast, 'success').mockReturnValue('id');
  const error = spyOn(toast, 'error').mockReturnValue('id');
  const restore = () => {
    success.mockRestore();
    error.mockRestore();
  };
  addTeardown(restore);
  return { success, error, restore };
}
