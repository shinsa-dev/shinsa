import { appendFileSync, closeSync, existsSync, openSync, readSync, statSync, watch } from 'node:fs';

export function readRange(path: string, from: number, to: number) {
  const bytes = Buffer.alloc(to - from);
  const handle = openSync(path, 'r');
  try {
    readSync(handle, bytes, 0, bytes.length, from);
  } finally {
    closeSync(handle);
  }
  return bytes;
}

export function readSize(path: string) {
  return existsSync(path) ? statSync(path).size : -1;
}

export function watchTranscript(path: string, onChange: () => void) {
  return watch(path, onChange);
}

export function appendLine(path: string, line: string) {
  appendFileSync(path, line);
}
