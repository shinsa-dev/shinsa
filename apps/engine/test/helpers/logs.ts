import { spyOn } from 'bun:test';

interface LoggedEntry {
  message: string;
  level: string;
  [field: string]: unknown;
}

export function captureLogs() {
  const entries: LoggedEntry[] = [];
  const spies = [process.stdout, process.stderr].map((stream) => {
    const write = stream.write.bind(stream);
    return spyOn(stream, 'write').mockImplementation((chunk: unknown, ...rest: unknown[]) => {
      const text = String(chunk);
      if (!text.startsWith('{"at":')) return write(chunk as string, ...(rest as []));
      for (const line of text.split('\n')) if (line) entries.push(JSON.parse(line));
      return true;
    });
  });
  const restore = () => {
    for (const spy of spies) spy.mockRestore();
  };
  const fieldsOf = (message: string) =>
    entries
      .filter((entry) => entry.message === message)
      .map(({ at: _at, level: _level, message: _message, ...fields }) => fields);
  return { entries, fieldsOf, restore };
}
