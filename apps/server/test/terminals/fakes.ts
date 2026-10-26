import type { TerminalInfo } from '@shinsa/core';
import type { TerminalProcess, TerminalSpawner, TerminalSpawnOptions } from '../../src/terminals/pty.ts';
import type { TerminalViewer } from '../../src/terminals/session.ts';

interface FakeProcess extends TerminalProcess {
  command: string[];
  options: TerminalSpawnOptions;
  written: string[];
  sizes: [number, number][];
  hungUp: boolean;
  emit: (text: string) => void;
  exit: (code: number) => void;
}

export function createFakeSpawner() {
  const spawned: FakeProcess[] = [];
  const spawn: TerminalSpawner = (command, options) => {
    let resolveExit: (code: number) => void = () => undefined;
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    const process: FakeProcess = {
      pid: 1000 + spawned.length,
      command,
      options,
      written: [],
      sizes: [],
      hungUp: false,
      write: (data) => process.written.push(typeof data === 'string' ? data : new TextDecoder().decode(data)),
      resize: (cols, rows) => process.sizes.push([cols, rows]),
      hangUp: () => {
        process.hungUp = true;
        resolveExit(129);
      },
      exited,
      emit: (text) => options.onData(new TextEncoder().encode(text)),
      exit: (code) => resolveExit(code),
    };
    spawned.push(process);
    return process;
  };
  return { spawn, spawned };
}

export interface FakeViewer extends TerminalViewer {
  frames: (string | Uint8Array)[];
  bufferedBytes: number;
  answer: number;
  ended: boolean;
  text: () => string;
  controls: () => unknown[];
}

export function createFakeViewer(): FakeViewer {
  const viewer: FakeViewer = {
    frames: [],
    bufferedBytes: 0,
    answer: 1,
    ended: false,
    send: (data) => {
      viewer.frames.push(data);
      return viewer.answer;
    },
    buffered: () => viewer.bufferedBytes,
    end: () => {
      viewer.ended = true;
    },
    text: () =>
      viewer.frames
        .filter((frame): frame is Uint8Array => typeof frame !== 'string')
        .map((frame) => new TextDecoder().decode(frame))
        .join(''),
    controls: () =>
      viewer.frames
        .filter((frame): frame is string => typeof frame === 'string')
        .map((frame) => JSON.parse(frame)),
  };
  return viewer;
}

export function createInfo(extra: Partial<TerminalInfo> = {}): TerminalInfo {
  return {
    id: 't1',
    projectId: 'p1',
    name: null,
    title: null,
    cwd: '/tmp',
    place: 'repository',
    taskId: null,
    serviceId: null,
    status: 'running',
    exitCode: null,
    startedAt: 1,
    endedAt: null,
    ...extra,
  };
}
