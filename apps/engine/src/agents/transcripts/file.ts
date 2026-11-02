import { closeSync, existsSync, openSync, readSync, statSync, watch } from 'node:fs';
import { CHECK_MS } from './schema.ts';

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

export function watchFile(path: string, onChange: () => void) {
  return watch(path, onChange);
}

export function repeatEverySecond(check: () => void) {
  const timer = setInterval(check, CHECK_MS);
  timer.unref();
  return () => clearInterval(timer);
}
