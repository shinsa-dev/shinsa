import { describe, expect, it } from 'bun:test';
import {
  describeCommandLineInstall,
  resolveCommandLineScript,
  SHELL_COMMAND_PATH,
} from '../../src/lib/command-line.ts';

describe('the shinsa command', () => {
  it('links the bundled program into /usr/local/bin with one password prompt, quoting every path', () => {
    const script = resolveCommandLineScript('/Applications/Shinsa\'s "Copy".app/engine/bin/shinsa');
    expect(SHELL_COMMAND_PATH).toBe('/usr/local/bin/shinsa');
    expect(script).toBe(
      "do shell script \"mkdir -p /usr/local/bin && ln -sf '/Applications/Shinsa'\\\\''s \\\"Copy\\\".app/engine/bin/shinsa' '/usr/local/bin/shinsa'\" with prompt \"Shinsa wants to install the shinsa command.\" with administrator privileges"
    );
  });

  it('says what happened', () => {
    expect(describeCommandLineInstall({ kind: 'installed' }).message).toBe('The shinsa command is installed');
    expect(describeCommandLineInstall({ kind: 'missing' }).type).toBe('warning');
    expect(describeCommandLineInstall({ kind: 'failed', failure: 'User canceled.' })).toEqual({
      type: 'warning',
      message: 'The shinsa command was not installed',
      detail: 'User canceled.',
    });
  });
});
