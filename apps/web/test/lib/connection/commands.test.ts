import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import type { UserCommand } from '@shinsa/core';
import {
  copyText,
  describeFailure,
  requestWithToast,
  sendCommandWithToast,
} from '@/lib/connection/commands.ts';
import { connection } from '@/lib/connection/socket.ts';
import { spyOnToasts } from '../../support/commands.ts';

const COMMAND: UserCommand = { type: 'task.complete', taskId: 't1' };

let toasts: ReturnType<typeof spyOnToasts>;

beforeEach(() => {
  toasts = spyOnToasts();
});

afterEach(() => {
  toasts.restore();
});

describe('describeFailure', () => {
  it('uses the message of an error and stringifies anything else', () => {
    expect(describeFailure(new Error('The task is gone.'))).toBe('The task is gone.');
    expect(describeFailure('plain')).toBe('plain');
    expect(describeFailure(42)).toBe('42');
  });
});

describe('sendCommandWithToast', () => {
  it('sends the command and confirms it with the done toast', async () => {
    const command = spyOn(connection, 'command').mockResolvedValue(undefined);
    expect(await sendCommandWithToast(COMMAND, 'Marked done.')).toBe(true);
    expect(command).toHaveBeenCalledWith(COMMAND, undefined);
    expect(toasts.success).toHaveBeenCalledWith('Marked done.');
    command.mockRestore();
  });

  it('stays quiet on success without a done message', async () => {
    const command = spyOn(connection, 'command').mockResolvedValue(undefined);
    expect(await sendCommandWithToast(COMMAND)).toBe(true);
    expect(toasts.success).not.toHaveBeenCalled();
    command.mockRestore();
  });

  it('shows the server error and reports failure', async () => {
    const command = spyOn(connection, 'command').mockRejectedValue(new Error('This task is finished.'));
    expect(await sendCommandWithToast(COMMAND, 'Marked done.')).toBe(false);
    expect(toasts.error).toHaveBeenCalledWith('This task is finished.');
    expect(toasts.success).not.toHaveBeenCalled();
    command.mockRestore();
  });

  it('fails with a toast when not connected', async () => {
    expect(await sendCommandWithToast(COMMAND, 'Marked done.')).toBe(false);
    expect(toasts.error).toHaveBeenCalledWith('Not connected to Shinsa.');
  });
});

describe('requestWithToast', () => {
  it('confirms a request with a title and a description', async () => {
    expect(
      await requestWithToast(async () => {}, {
        title: 'Imported.',
        description: 'Take it out of claude-swap.',
      })
    ).toBe(true);
    expect(toasts.success).toHaveBeenCalledWith('Imported.', { description: 'Take it out of claude-swap.' });
  });
});

describe('copyText', () => {
  it('copies the text and says “Copied”, whatever was copied', async () => {
    const write = spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    expect(await copyText('feat/login')).toBe(true);
    expect(write).toHaveBeenCalledWith('feat/login');
    expect(toasts.success).toHaveBeenCalledWith('Copied');
    write.mockRestore();
  });

  it('says so when the clipboard refuses, and reports that nothing was copied', async () => {
    const write = spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    expect(await copyText('feat/login')).toBe(false);
    expect(toasts.success).not.toHaveBeenCalled();
    expect(toasts.error).toHaveBeenCalledWith('Couldn’t copy to the clipboard');
    write.mockRestore();
  });
});
