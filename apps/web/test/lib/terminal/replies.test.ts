import { describe, expect, it } from 'bun:test';
import { Terminal } from '@xterm/xterm';
import { ENGINE_ANSWERS, silenceEngineAnswers } from '@/lib/terminal/replies.ts';

function write(terminal: Terminal, data: string) {
  return new Promise<void>((resolve) => terminal.write(data, resolve));
}

describe('silenceEngineAnswers', () => {
  it('leaves a program’s questions to the engine, so each is answered once', async () => {
    const terminal = new Terminal({ allowProposedApi: true });
    const replies: string[] = [];
    terminal.onData((data) => replies.push(data));
    await write(terminal, '\u001b[c');
    expect(replies).toHaveLength(1);
    const stop = silenceEngineAnswers(terminal.parser);
    await write(
      terminal,
      '\u001b[c\u001b[>c\u001b[6n\u001b[?6n\u001b[?2004$p\u001b]11;?\u001b\\\u001bP$qm\u001b\\'
    );
    expect(replies).toHaveLength(1);
    await write(terminal, '\u001b]11;#000000\u001b\\');
    stop();
    await write(terminal, '\u001b[c');
    expect(replies).toHaveLength(2);
    terminal.dispose();
  });

  it('covers device attributes, status reports, mode reports, colours and settings', () => {
    expect(ENGINE_ANSWERS.csi.map((id) => `${id.prefix ?? ''}${id.intermediates ?? ''}${id.final}`)).toEqual([
      'c',
      '>c',
      '=c',
      'n',
      '?n',
      '$p',
      '?$p',
      '>q',
    ]);
    expect(ENGINE_ANSWERS.osc).toEqual([4, 10, 11, 12]);
  });
});
