import { closeSync, openSync, writeSync } from 'node:fs';

export function redirectOutput(path: string, streams: NodeJS.WriteStream[]) {
  const fd = openSync(path, 'a');
  for (const stream of streams) {
    stream.write = ((chunk: string | Uint8Array) => {
      writeSync(fd, typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      return true;
    }) as typeof stream.write;
  }
  return () => closeSync(fd);
}
