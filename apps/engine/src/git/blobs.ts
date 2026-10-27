import { CODE_LIMITS } from '@shinsa/core';
import { killProcessGroup } from '../shell/index.ts';

export interface ObjectInfo {
  object: string;
  type: string;
  size: number;
}

type Reply = { kind: 'info'; info: ObjectInfo | null } | { kind: 'contents'; bytes: Uint8Array };

interface Waiting {
  kind: Reply['kind'];
  resolve: (reply: Reply) => void;
  reject: (error: Error) => void;
}

export interface BatchChild {
  pid: number;
  stdin: { write: (text: string) => unknown; flush: () => unknown };
  stdout: ReadableStream<Uint8Array>;
  exited: Promise<number>;
}

const NEWLINE = 10;

const IDLE_MS = 30_000;

const BATCH_ENV = { GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat' };

const DECODER = new TextDecoder();

function joinBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length === 0) return b;
  const joined = new Uint8Array(a.length + b.length);
  joined.set(a);
  joined.set(b, a.length);
  return joined;
}

export function parseInfoLine(line: string): ObjectInfo | null {
  const [object = '', type = '', size = ''] = line.split(' ');
  if (!/^[0-9a-f]{40,64}$/.test(object) || !type || !/^\d+$/.test(size)) return null;
  return { object, type, size: Number(size) };
}

export function isBatchName(name: string) {
  return name.length > 0 && !name.includes('\n') && !name.includes('\0');
}

function spawnBatch(repoPath: string): BatchChild {
  return Bun.spawn(['git', 'cat-file', '--batch-command'], {
    cwd: repoPath,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'ignore',
    detached: true,
    env: { ...Bun.env, ...BATCH_ENV },
  });
}

export interface CatFileOptions {
  idleMs?: number;
  timeoutMs?: number;
  spawn?: (repoPath: string) => BatchChild;
}

export class CatFile {
  readonly #repoPath: string;
  readonly #idleMs: number;
  readonly #timeoutMs: number;
  readonly #spawn: (repoPath: string) => BatchChild;
  #child: BatchChild | null = null;
  #buffer: Uint8Array = new Uint8Array();
  #waiting: Waiting[] = [];
  #idle: ReturnType<typeof setTimeout> | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(repoPath: string, options: CatFileOptions = {}) {
    this.#repoPath = repoPath;
    this.#idleMs = options.idleMs ?? IDLE_MS;
    this.#timeoutMs = options.timeoutMs ?? CODE_LIMITS.readMs;
    this.#spawn = options.spawn ?? spawnBatch;
  }

  get running() {
    return this.#child !== null;
  }

  info(name: string): Promise<ObjectInfo | null> {
    return this.#send(`info ${name}\n`, 'info').then((reply) => (reply.kind === 'info' ? reply.info : null));
  }

  contents(object: string): Promise<Uint8Array> {
    return this.#send(`contents ${object}\n`, 'contents').then((reply) =>
      reply.kind === 'contents' ? reply.bytes : new Uint8Array()
    );
  }

  close() {
    const child = this.#child;
    this.#child = null;
    this.#buffer = new Uint8Array();
    if (this.#idle) clearTimeout(this.#idle);
    if (this.#timer) clearTimeout(this.#timer);
    this.#idle = null;
    this.#timer = null;
    const waiting = this.#waiting;
    this.#waiting = [];
    for (const each of waiting) each.reject(new Error('The object reader stopped.'));
    if (child) killProcessGroup(child.pid);
  }

  #send(command: string, kind: Reply['kind']) {
    return new Promise<Reply>((resolve, reject) => {
      const child = this.#start();
      this.#waiting.push({ kind, resolve, reject });
      if (this.#idle) clearTimeout(this.#idle);
      this.#idle = null;
      this.#timer ??= setTimeout(() => this.close(), this.#timeoutMs);
      child.stdin.write(command);
      child.stdin.flush();
    });
  }

  #start() {
    if (this.#child) return this.#child;
    const child = this.#spawn(this.#repoPath);
    this.#child = child;
    void this.#read(child);
    void child.exited.then(() => {
      if (this.#child === child) this.close();
    });
    return child;
  }

  async #read(child: BatchChild) {
    for await (const chunk of child.stdout) {
      if (this.#child !== child) return;
      this.#buffer = joinBytes(this.#buffer, chunk);
      this.#drain();
    }
  }

  #drain() {
    for (let next = this.#waiting[0]; next; next = this.#waiting[0]) {
      const end = this.#buffer.indexOf(NEWLINE);
      if (end < 0) return;
      const line = DECODER.decode(this.#buffer.subarray(0, end));
      const info = parseInfoLine(line);
      if (next.kind === 'info' || !info) {
        this.#buffer = this.#buffer.subarray(end + 1);
        this.#settle({ kind: 'info', info });
        continue;
      }
      const start = end + 1;
      if (this.#buffer.length < start + info.size + 1) return;
      const bytes = this.#buffer.slice(start, start + info.size);
      this.#buffer = this.#buffer.subarray(start + info.size + 1);
      this.#settle({ kind: 'contents', bytes });
    }
  }

  #settle(reply: Reply) {
    const waiting = this.#waiting.shift();
    waiting?.resolve(reply);
    if (this.#waiting.length > 0) return;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#idle = setTimeout(() => this.close(), this.#idleMs);
  }
}

export class CatFilePool {
  readonly #readers = new Map<string, CatFile>();
  readonly #idleMs: number;

  constructor(idleMs = IDLE_MS) {
    this.#idleMs = idleMs;
  }

  select(repoPath: string) {
    const known = this.#readers.get(repoPath);
    if (known) return known;
    const reader = new CatFile(repoPath, { idleMs: this.#idleMs });
    this.#readers.set(repoPath, reader);
    return reader;
  }

  close() {
    for (const reader of this.#readers.values()) reader.close();
    this.#readers.clear();
  }
}
