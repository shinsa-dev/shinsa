import { appendFileSync, closeSync, existsSync, openSync, readSync, statSync, watch } from 'node:fs';
import { Result } from 'effect';

export function readRange(path: string, from: number, to: number) {
  const bytes = Buffer.alloc(to - from);
  const opened = Result.try(() => openSync(path, 'r'));
  if (Result.isFailure(opened)) return Buffer.alloc(0);
  const read = Result.try(() => readSync(opened.success, bytes, 0, bytes.length, from));
  closeSync(opened.success);
  return Result.isSuccess(read) ? bytes : Buffer.alloc(0);
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
